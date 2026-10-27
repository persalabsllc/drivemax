import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { demoWorkspace } from "../lib/demo";
import {
  workToday,
  matchInventory,
  emptyPreferences,
  emptyProgress,
  emptyPrep,
} from "../lib/sales-work";
import { verifyWorkflows } from "../scripts/verify-workflows.mjs";
import { salesFunnel } from "../lib/sales-reports";
import { dayKey } from "../lib/model";
const org = "d5a1c100-0000-4000-8000-000000000001",
  owner = "00000000-0000-4000-8000-000000000099",
  sales = "00000000-0000-4000-8000-000000000098",
  other = "00000000-0000-4000-8000-000000000097";
test("sales workflows: real SQL scheduling, deduplication, appointment changes, stopping rules and tenant permissions", async (t) => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const command = async (p: unknown, actor = owner, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        actor,
        JSON.stringify(p),
      ])
    ).id;
  const prepare = () => one("select dmcrm_workflow_prepare() n");
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const f of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(
      `insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Test Owner','owner');`,
    );
    for (const f of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const staff = (
      await one("select id from dmcrm_staff where org_id=$1 and user_id=$2", [
        org,
        owner,
      ])
    ).id;
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales User','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales User','sales@example.invalid','sales');insert into dmcrm_orgs(id,name,slug) values('${other}','Other dealership','workflow-other');update dmcrm_workflow_rules set business_hours=false;`,
    );
    const make = async () => {
      const c = await one(
        "insert into dmcrm_customers(org_id,name,email,source,assigned_to) values($1,'Jamie Example',$2,'Website',$3) returning *",
        [org, `${crypto.randomUUID()}@example.invalid`, staff],
      );
      const o = await one(
        "insert into dmcrm_opportunities(org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,'Ford Fusion') returning *",
        [org, c.id, staff],
      );
      return { c, o };
    };
    await t.test(
      "enrolls future lead steps once and excludes SMS",
      async () => {
        const { c, o } = await make();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where opportunity_id=$1",
              [o.id],
            )
          ).n,
          6,
        );
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_email_outbox b join dmcrm_messages m on m.id=b.message_id where m.customer_id=$1",
              [c.id],
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_rules where channel='sms'",
            )
          ).n,
          0,
        );
      },
    );
    await t.test(
      "confirmation, reschedule and missed emails replace stale messages without duplicates",
      async () => {
        const { c, o } = await make();
        const id = crypto.randomUUID(),
          starts = new Date(Date.now() + 7 * 86400000).toISOString();
        const ap = {
          customer_id: c.id,
          opportunity_id: o.id,
          assigned_to: staff,
          kind: "test_drive",
          starts_at: starts,
          duration_minutes: 30,
          description: "Return with spouse",
        };
        await command({
          type: "save_appointment",
          id,
          revision: 0,
          appointment: ap,
        });
        await prepare();
        const original = await one(
          "select j.message_id,m.body from dmcrm_workflow_jobs j join dmcrm_messages m on m.id=j.message_id where j.appointment_id=$1 and j.event='appointment_created'",
          [id],
        );
        assert.match(original.body, /appointment\/|test drive/);
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where appointment_id=$1 and event='appointment_created'",
              [id],
            )
          ).n,
          1,
        );
        await command({
          type: "save_appointment",
          id,
          revision: 0,
          appointment: {
            ...ap,
            starts_at: new Date(Date.now() + 8 * 86400000).toISOString(),
          },
        });
        await prepare();
        assert.equal(
          (
            await one(
              "select state from dmcrm_email_outbox where message_id=$1",
              [original.message_id],
            )
          ).state,
          "canceled",
        );
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where appointment_id=$1 and event='appointment_rescheduled' and state='queued'",
              [id],
            )
          ).n,
          1,
        );
        const current = await one(
          "select revision from dmcrm_appointments where id=$1",
          [id],
        );
        await command({
          type: "set_appointment_status",
          id,
          revision: current.revision,
          status: "no_show",
        });
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where appointment_id=$1 and event='no_show' and state='queued'",
              [id],
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where appointment_id=$1 and event like 'reminder%' and state='scheduled'",
              [id],
            )
          ).n,
          0,
        );
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where appointment_id=$1 and event='no_show'",
              [id],
            )
          ).n,
          1,
        );
      },
    );
    await t.test(
      "reply cancels a queued nurture email before the provider claims it",
      async () => {
        const { c, o } = await make();
        await pg.query(
          "update dmcrm_workflow_jobs set run_at=now(),anchor_at=now()-interval '1 minute' where opportunity_id=$1",
          [o.id],
        );
        await prepare();
        await pg.query(
          "insert into dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by) values(gen_random_uuid(),$1,$2,$3,'email','inbound','received','customer@example.invalid','Question','Is it available?',$4)",
          [org, c.id, o.id, owner],
        );
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where opportunity_id=$1 and state in('queued','scheduled')",
              [o.id],
            )
          ).n,
          0,
        );
      },
    );
    await t.test(
      "pause cancels pending work and resume does not resurrect it",
      async () => {
        const { c, o } = await make();
        await command({
          type: "pause_customer_workflows",
          customer_id: c.id,
          paused: true,
        });
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where opportunity_id=$1 and state='canceled'",
              [o.id],
            )
          ).n,
          6,
        );
        await command({
          type: "pause_customer_workflows",
          customer_id: c.id,
          paused: false,
        });
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where opportunity_id=$1 and state='scheduled'",
              [o.id],
            )
          ).n,
          0,
        );
      },
    );
    await t.test(
      "customer link view does not confirm; request is deduplicated and unsubscribe suppresses sends",
      async () => {
        const { c, o } = await make(),
          id = crypto.randomUUID();
        await command({
          type: "save_appointment",
          id,
          revision: 0,
          appointment: {
            customer_id: c.id,
            opportunity_id: o.id,
            assigned_to: staff,
            kind: "return_visit",
            starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
            duration_minutes: 30,
            description: "",
          },
        });
        await prepare();
        const link = await one(
          "select token from dmcrm_appointment_links where appointment_id=$1",
          [id],
        );
        await one("select dmcrm_public_appointment($1) result", [link.token]);
        assert.equal(
          (await one("select status from dmcrm_appointments where id=$1", [id]))
            .status,
          "scheduled",
        );
        await one("select dmcrm_public_appointment($1,'confirm') result", [
          link.token,
        ]);
        assert.equal(
          (await one("select status from dmcrm_appointments where id=$1", [id]))
            .status,
          "confirmed",
        );
        await one(
          "select dmcrm_public_appointment($1,'request','Tomorrow afternoon please') result",
          [link.token],
        );
        await one(
          "select dmcrm_public_appointment($1,'request','Tomorrow afternoon please') result",
          [link.token],
        );
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_tasks where customer_id=$1 and title='Customer requested an appointment change'",
              [c.id],
            )
          ).n,
          1,
        );
        const contact = await one(
          "select token from dmcrm_workflow_contacts where customer_id=$1",
          [c.id],
        );
        await one("select dmcrm_public_unsubscribe($1,true)", [contact.token]);
        assert.equal(
          (
            await one("select email_opt_out from dmcrm_customers where id=$1", [
              c.id,
            ])
          ).email_opt_out,
          true,
        );
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where customer_id=$1 and state='queued'",
              [c.id],
            )
          ).n,
          0,
        );
      },
    );
    await t.test(
      "rules and deal state enforce ownership, tenant scope and revisions",
      async () => {
        const rule = await one("select * from dmcrm_workflow_rules limit 1");
        await assert.rejects(
          command(
            {
              type: "save_workflow_rule",
              id: rule.id,
              revision: rule.revision,
              rule,
            },
            sales,
          ),
          /Manager access/,
        );
        await assert.rejects(
          command({
            type: "save_workflow_rule",
            id: rule.id,
            revision: 99,
            rule,
          }),
          /Workflow changed/,
        );
        const { o } = await make();
        const old = await one(
          "select revision from dmcrm_deal_progress where id=$1",
          [o.id],
        );
        await command({
          type: "save_deal_progress",
          id: o.id,
          revision: old.revision,
          progress: { ...emptyProgress, stage: "numbers" },
        });
        await assert.rejects(
          command({
            type: "save_deal_progress",
            id: o.id,
            revision: old.revision,
            progress: emptyProgress,
          }),
          /Record changed/,
        );
        await assert.rejects(
          command(
            {
              type: "save_deal_progress",
              id: o.id,
              revision: old.revision + 1,
              progress: emptyProgress,
            },
            sales,
          ),
          /Assigned salesperson/,
        );
        await pg.exec("set role anon");
        await assert.rejects(
          one("select dmcrm_workflow_prepare()"),
          /permission denied/,
        );
        await assert.rejects(
          one("select * from dmcrm_workflow_jobs"),
          /permission denied/,
        );
        await pg.exec("reset role");
      },
    );
    await t.test(
      "overlapping opportunities queue at most one nurture email per customer",
      async () => {
        const { c, o } = await make();
        await pg.query(
          "insert into dmcrm_opportunities(org_id,customer_id,assigned_to) values($1,$2,$3)",
          [org, c.id, staff],
        );
        await pg.query(
          "update dmcrm_workflow_jobs set run_at=now() where customer_id=$1",
          [c.id],
        );
        await prepare();
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_workflow_jobs where customer_id=$1 and state='queued'",
              [c.id],
            )
          ).n,
          1,
        );
      },
    );
    await t.test(
      "custom task automation creates one assigned task and changed rule cancels obsolete actions",
      async () => {
        const id = crypto.randomUUID();
        const rule = {
          name: "Call new inquiry",
          event: "new_lead",
          channel: "task",
          template_id: null,
          task_title: "Call new inquiry",
          delay_minutes: 0,
          enabled: true,
          business_hours: false,
          stop_on_reply: true,
        };
        await command({ type: "save_workflow_rule", id, revision: 0, rule });
        const { c } = await make();
        await prepare();
        await prepare();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_tasks where customer_id=$1 and title='Call new inquiry' and assigned_to=$2",
              [c.id, staff],
            )
          ).n,
          1,
        );
        await command({
          type: "save_workflow_rule",
          id,
          revision: 0,
          rule: { ...rule, delay_minutes: 1440 },
        });
        const next = await make();
        await command({
          type: "save_workflow_rule",
          id,
          revision: 1,
          rule: { ...rule, event: "sold" },
        });
        assert.equal(
          (
            await one(
              "select state from dmcrm_workflow_jobs where rule_id=$1 and customer_id=$2",
              [id, next.c.id],
            )
          ).state,
          "canceled",
        );
        await command({ type: "delete_workflow_rule", id, revision: 2 });
      },
    );
    await t.test(
      "recon replaces its total once, funding requires a date, and another tenant cannot change records",
      async () => {
        const vehicle = await one(
          "insert into dmcrm_inventory(org_id,year,make,model,stock_number,vin,cost,price,mileage,acquired_on) values($1,2020,'Ford','Fusion',$2,$3,5000,7500,100000,current_date) returning id",
          [
            org,
            "TEST-" + crypto.randomUUID().slice(0, 8),
            crypto.randomUUID().replaceAll("-", "").slice(0, 17).toUpperCase(),
          ],
        );
        const prep = {
          ...emptyPrep,
          stage: "repair",
          items: [
            {
              id: crypto.randomUUID(),
              description: "Tires",
              vendor: "Test vendor",
              amount: 250,
              due_on: "",
              done: true,
            },
          ],
        };
        await command({
          type: "save_inventory_prep",
          id: vehicle.id,
          revision: 0,
          prep,
          sync_recon: true,
        });
        await command({
          type: "save_inventory_prep",
          id: vehicle.id,
          revision: 0,
          prep,
          sync_recon: true,
        });
        assert.equal(
          Number(
            (
              await one("select recon from dmcrm_inventory where id=$1", [
                vehicle.id,
              ])
            ).recon,
          ),
          250,
        );
        await assert.rejects(
          command(
            {
              type: "save_inventory_prep",
              id: vehicle.id,
              revision: 1,
              prep,
              sync_recon: true,
            },
            sales,
          ),
          /Manager access/,
        );
        const { o } = await make();
        await assert.rejects(
          command({
            type: "save_deal_progress",
            id: o.id,
            revision: 0,
            progress: { ...emptyProgress, funding: "funded" },
          }),
          /Enter the funded date/,
        );
        await command({
          type: "save_deal_progress",
          id: o.id,
          revision: 0,
          progress: {
            ...emptyProgress,
            funding: "funded",
            funded_on: "2026-10-27",
          },
        });
        await pg.query(
          "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Other owner','owner')",
          [other, owner],
        );
        await pg.query(
          "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Other owner','other@example.invalid','owner')",
          [other, owner],
        );
        await assert.rejects(
          command(
            {
              type: "save_deal_progress",
              id: o.id,
              revision: 1,
              progress: emptyProgress,
            },
            owner,
            other,
          ),
          /Assigned salesperson/,
        );
      },
    );
    await t.test(
      "push only targets authorized users and a deactivated member cannot claim a queued alert",
      async () => {
        await pg.query(
          "insert into dmcrm_push_subscriptions(org_id,user_id,endpoint,keys) values($1,$2,'https://fcm.googleapis.com/test-owner','{}'),($1,$3,'https://fcm.googleapis.com/test-sales','{}')",
          [org, owner, sales],
        );
        const { o } = await make();
        assert.equal(
          (
            await one(
              "select count(*)::int n from dmcrm_push_jobs where opportunity_id=$1",
              [o.id],
            )
          ).n,
          1,
        );
        await pg.query(
          "update dmcrm_members set active=false where org_id=$1 and user_id=$2",
          [org, owner],
        );
        const claims = await pg.query("select * from dmcrm_push_claim()");
        assert.equal(claims.rows.length, 0);
        await pg.query(
          "update dmcrm_members set active=true where org_id=$1 and user_id=$2",
          [org, owner],
        );
      },
    );
    await t.test(
      "release verification runs entirely inside a rollback",
      async () => {
        await pg.exec("begin");
        try {
          await verifyWorkflows({
            query: (sql: string, args: unknown[] = []) => pg.query(sql, args),
          });
        } finally {
          await pg.exec("rollback");
        }
      },
    );
  } finally {
    await pg.close();
  }
});
test("Work Today ownership, matching and first human response exclude automatic messages", () => {
  const ws = demoWorkspace(),
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  const now = new Date();
  o.created_at = new Date(now.getTime() - 3600000).toISOString();
  o.status = "new";
  ws.activities = [];
  ws.visits = [];
  ws.appointments = [];
  ws.messages = [
    {
      id: crypto.randomUUID(),
      org_id: ws.org.id,
      customer_id: c.id,
      opportunity_id: o.id,
      channel: "email",
      direction: "outbound",
      status: "sent",
      recipient: c.email,
      subject: "Thanks",
      body: "Automated",
      created_by: "00000000-0000-4000-8000-000000000000",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      quote_id: null,
      task_id: null,
      revision: 0,
    },
  ];
  const report = salesFunnel(ws, dayKey(o.created_at), dayKey(now));
  assert.equal(report.summary.contacted, 0);
  assert.equal(report.summary.responseMinutes, null);
  assert.ok(
    workToday(ws, now).some(
      (r) => r.kind === "lead" && r.opportunity_id === o.id,
    ),
  );
  const stock = ws.inventory.find((v) => v.status === "in_stock")!;
  const p = {
    ...emptyPreferences,
    id: c.id,
    org_id: ws.org.id,
    revision: 0,
    max_price: stock.price - 1,
    make: stock.make,
  };
  assert.ok(!matchInventory(p, [stock]).length);
  p.max_price = stock.price;
  assert.equal(matchInventory(p, [stock]).length, 1);
  stock.status = "sold";
  assert.equal(matchInventory(p, [stock]).length, 0);
});
