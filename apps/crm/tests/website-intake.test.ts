import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  captureContactNotice,
  CONTACT_NOTICE_VERSION,
} from "../../../lib/contact-notice";
import { purchaseSummary } from "../../../lib/purchase-requests";
import { AttentionCenter } from "../components/Attention";
import { vehicleDetailsSchema } from "../lib/vehicles";
import { attentionCommand, type AttentionFeed } from "../lib/attention";
import { verifyWebsiteIntake } from "../scripts/verify-website-intake.mjs";

const org = "d5a1c100-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000099";
const sales = "00000000-0000-4000-8000-000000000098";
const otherOrg = "00000000-0000-4000-8000-000000000097";

test("website forms become durable CRM opportunities, without changing the original website intake", async (t) => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const payload = (extra: Record<string, unknown> = {}) =>
    captureContactNotice(
      {
        requestId: crypto.randomUUID(),
        kind: "contact",
        name: "Morgan Example",
        email: "morgan@example.invalid",
        phone: "(202) 555-0123",
        preferredContact: "Email",
        message: "Can you help me find a car?",
        contactNoticeVersion: CONTACT_NOTICE_VERSION,
        smsConsent: "no",
        ...extra,
      },
      "2026-10-26T14:00:00Z",
    );
  const submit = async (p: Record<string, unknown>) => {
    await pg.query("select submit_lead($1::jsonb)", [JSON.stringify(p)]);
    return one("select * from dmcrm_website_intake where id=$1", [p.requestId]);
  };
  const feed = async (
    actor = owner,
    organization = org,
  ): Promise<AttentionFeed> =>
    (await one("select dmcrm_attention($1,$2) feed", [organization, actor]))
      .feed;
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(`insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid');
      insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Test Owner','owner');`);
    const migrations = (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort();
    for (const name of migrations.filter((f) => Number(f.slice(0, 3)) <= 11))
      await pg.exec(
        await fs.readFile(new URL("../db/" + name, import.meta.url), "utf8"),
      );
    const historical = payload({
      name: "Historical Open",
      email: "history@example.invalid",
      phone: "2025550100",
    });
    const closed = payload({
      name: "Closed Website",
      email: "closed@example.invalid",
      phone: "2025550101",
    });
    await pg.query("select submit_lead($1::jsonb),submit_lead($2::jsonb)", [
      JSON.stringify(historical),
      JSON.stringify(closed),
    ]);
    await pg.query("update leads set status='won' where id=$1", [
      closed.requestId,
    ]);
    await pg.exec(
      await fs.readFile(
        new URL("../db/012_website_intake.sql", import.meta.url),
        "utf8",
      ),
    );
    await pg.exec(`insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales User','sales');
      insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales User','sales@example.invalid','sales');
      insert into dmcrm_orgs(id,name,slug) values('${otherOrg}','Other organization','other');
      insert into dmcrm_members(org_id,user_id,name,role) values('${otherOrg}','${owner}','Test Owner','owner');
      insert into dmcrm_staff(org_id,user_id,name,email,role) values('${otherOrg}','${owner}','Test Owner','owner@example.invalid','owner');`);
    const salesperson = (
      await one("select id from dmcrm_staff where user_id=$1 and org_id=$2", [
        sales,
        org,
      ])
    ).id;

    await t.test(
      "migration imports open history and leaves closed website deals alone",
      async () => {
        assert.equal(
          (
            await one("select state from dmcrm_website_intake where id=$1", [
              historical.requestId,
            ])
          ).state,
          "imported",
        );
        assert.equal(
          await one("select id from dmcrm_website_intake where id=$1", [
            closed.requestId,
          ]),
          undefined,
        );
      },
    );
    await t.test(
      "production verification uses real submit_lead and rolls all fixtures back",
      async () => {
        const before = await one(
          "select (select count(*) from leads) leads,(select count(*) from dmcrm_customers) customers,(select count(*) from lead_notifications) notifications",
        );
        await pg.exec("begin");
        await verifyWebsiteIntake(pg);
        await pg.exec("commit");
        assert.deepEqual(
          await one(
            "select (select count(*) from leads) leads,(select count(*) from dmcrm_customers) customers,(select count(*) from lead_notifications) notifications",
          ),
          before,
        );
      },
    );

    let inquiry: any;
    const first = payload();
    await t.test(
      "contact form creates one customer, opportunity, original activity, due task and alert",
      async () => {
        await pg.exec("set role service_role");
        inquiry = await submit(first);
        await submit(first);
        await pg.exec("reset role");
        assert.equal(inquiry.state, "imported", inquiry.last_error_code);
        const c = await one("select * from dmcrm_customers where id=$1", [
          inquiry.customer_id,
        ]);
        assert.equal(c.source, "Website");
        assert.equal(c.assigned_to, null);
        const op = await one("select * from dmcrm_opportunities where id=$1", [
          inquiry.opportunity_id,
        ]);
        assert.equal(op.status, "new");
        assert.equal(op.source, "Website");
        assert.equal(op.inventory_id, null);
        const task = await one(
          "select * from dmcrm_tasks where opportunity_id=$1",
          [op.id],
        );
        assert.equal(task.channel, "email");
        assert.equal(task.assigned_to, null);
        assert.equal(
          new Date(task.due_date).toISOString().slice(0, 10),
          (
            await one(
              "select to_char(now() at time zone 'America/New_York','YYYY-MM-DD') as today",
            )
          ).today,
        );
        const activity = await one(
          "select * from dmcrm_activities where id=$1",
          [inquiry.activity_id],
        );
        assert.match(activity.body, /Can you help me find a car/);
        assert.match(activity.body, /SMS consent: no/);
        assert.equal(activity.created_by, "Drive Max website");
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_opportunities where customer_id=$1",
                [c.id],
              )
            ).n,
          ),
          1,
        );
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from lead_notifications where lead_id=$1",
                [first.requestId],
              )
            ).n,
          ),
          1,
        );
        const alerts = await feed();
        assert.equal(alerts.websiteIntake?.pending, 0);
        assert.ok(
          alerts.items.some((i) => i.key === `website:${first.requestId}`),
        );
        assert.ok(
          !alerts.items.some(
            (i) => i.kind === "lead" && i.customer_id === c.id,
          ),
        );
        assert.ok(
          !(await feed(sales)).items.some((i) => i.customer_id === c.id),
        );
      },
    );
    await t.test(
      "returning customers get a new opportunity and alert, preserving their sold deal and assignment",
      async () => {
        await pg.query(
          "update dmcrm_customers set status='sold',assigned_to=$2 where id=$1",
          [inquiry.customer_id, salesperson],
        );
        await pg.query(
          "update dmcrm_opportunities set status='sold' where id=$1",
          [inquiry.opportunity_id],
        );
        const returning = await submit(
          payload({
            phone: "+1 202-555-0123",
            email: "MORGAN@example.invalid",
          }),
        );
        assert.equal(returning.customer_id, inquiry.customer_id);
        assert.equal(returning.created_customer, false);
        assert.notEqual(returning.opportunity_id, inquiry.opportunity_id);
        assert.equal(
          (
            await one("select status from dmcrm_opportunities where id=$1", [
              inquiry.opportunity_id,
            ])
          ).status,
          "sold",
        );
        assert.equal(
          (
            await one(
              "select assigned_to from dmcrm_opportunities where id=$1",
              [returning.opportunity_id],
            )
          ).assigned_to,
          salesperson,
        );
        assert.ok((await feed(sales)).items.some((i) => i.id === returning.id));
        await pg.query("select dmcrm_command($1,$2,$3::jsonb)", [
          org,
          sales,
          JSON.stringify({
            type: "review_attention",
            kind: "website",
            id: returning.id,
          }),
        ]);
        assert.ok(
          !(await feed(sales)).items.some((i) => i.id === returning.id),
        );
        assert.ok((await feed()).items.some((i) => i.id === returning.id));
        assert.ok(
          !(await feed(owner, otherOrg)).items.some(
            (i) => i.id === returning.id,
          ),
        );
      },
    );
    await t.test(
      "shared family contact and conflicting matches are never silently merged",
      async () => {
        const spouse = await submit(
          payload({ name: "Alex Example", email: "alex@example.invalid" }),
        );
        assert.notEqual(spouse.customer_id, inquiry.customer_id);
        assert.equal(spouse.match_review, true);
        const ambiguous = await submit(payload());
        assert.notEqual(ambiguous.customer_id, inquiry.customer_id);
        assert.equal(ambiguous.match_review, true);
        const activity = await one(
          "select body from dmcrm_activities where id=$1",
          [ambiguous.activity_id],
        );
        assert.match(activity.body, /Contact match needs review/);
      },
    );
    await t.test(
      "test-drive vehicle matches CRM VIN, preserves the requested time, and never books or reserves automatically",
      async () => {
        const websiteVehicle =
          await one(`insert into vehicles(slug,year,make,model,vin,stock_number,miles,internet_price,description,photos,status)
        values('fixture-vehicle',2020,'Ford','Fusion','3FA6P0H72LR100001','WEB-100',45678,12000,'Fictional vehicle for integration tests.',array['https://example.invalid/car.jpg'],'available') returning *`);
        const inventory = await one(
          `insert into dmcrm_inventory(org_id,year,make,model,vin,stock_number,mileage,cost,price,acquired_on)
        values($1,2020,'Ford','Fusion',$2,'CRM-100',45678,8000,12000,current_date) returning *`,
          [org, websiteVehicle.vin],
        );
        // The server-captured snapshot emitted by the existing website route.
        const request = payload({
          kind: "vehicle",
          name: "Taylor Driver",
          email: "driver@example.invalid",
          phone: "2025550144",
          purpose: "test-drive",
          preferredVisit: "Tomorrow at 3 PM",
          preferredContact: "Text message",
          smsConsent: "yes",
          vehicleId: websiteVehicle.id,
          originalVehicleVin: websiteVehicle.vin,
          originalVehicleTitle: "2020 Ford Fusion",
          originalVehicleStock: websiteVehicle.stock_number,
          originalVehicleMiles: String(websiteVehicle.miles),
        });
        const q = await submit(request);
        assert.equal(q.state, "imported", q.last_error_code);
        assert.notEqual(websiteVehicle.id, inventory.id);
        const op = await one("select * from dmcrm_opportunities where id=$1", [
          q.opportunity_id,
        ]);
        assert.equal(op.inventory_id, inventory.id);
        assert.equal(op.vehicle_details.vin, websiteVehicle.vin);
        assert.equal(
          (
            await one(
              "select channel from dmcrm_tasks where opportunity_id=$1",
              [op.id],
            )
          ).channel,
          "sms",
        );
        assert.match(
          (
            await one("select body from dmcrm_activities where id=$1", [
              q.activity_id,
            ])
          ).body,
          /Requested visit \(awaiting confirmation\): Tomorrow at 3 PM/,
        );
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_appointments where customer_id=$1",
                [q.customer_id],
              )
            ).n,
          ),
          0,
        );
        assert.equal(
          (
            await one("select status from dmcrm_inventory where id=$1", [
              inventory.id,
            ])
          ).status,
          "in_stock",
        );
        await pg.query("update dmcrm_inventory set status='sold' where id=$1", [
          inventory.id,
        ]);
        const unavailable = await submit({
          ...request,
          requestId: crypto.randomUUID(),
        });
        assert.equal(
          (
            await one(
              "select inventory_id from dmcrm_opportunities where id=$1",
              [unavailable.opportunity_id],
            )
          ).inventory_id,
          null,
        );
        const manual = await one(
          "select vehicle_details from dmcrm_opportunities where id=$1",
          [unavailable.opportunity_id],
        );
        assert.ok(
          vehicleDetailsSchema.safeParse(manual.vehicle_details).success,
        );
        assert.equal(manual.vehicle_details.vin, websiteVehicle.vin);
      },
    );
    await t.test(
      "sell-your-car details and financing arrive intact, without adding inventory or granting legacy SMS consent",
      async () => {
        const before = await one(
          "select (select count(*) from dmcrm_inventory) inventory,(select count(*) from dmcrm_trades) trades",
        );
        const p = payload({
          kind: "vehicle",
          purpose: "purchase-offer",
          name: "Casey Seller",
          email: "seller@example.invalid",
          phone: "2025550166",
          sellerYear: "2018",
          sellerMake: "Toyota",
          sellerModel: "Camry",
          sellerVin: "4T1B11HK2JU100001",
          sellerMiles: "98765",
          condition: "Good",
          titleStatus: "Clean title",
          loanStatus: "Loan balance",
          sellerZip: "27870",
          askingPrice: "9000",
          message: "Please call after 5.",
        });
        p.message = purchaseSummary(p as any);
        const q = await submit(p);
        assert.equal(q.state, "imported", q.last_error_code);
        const op = await one("select * from dmcrm_opportunities where id=$1", [
          q.opportunity_id,
        ]);
        assert.match(op.title, /Sell us your car · 2018 Toyota Camry/);
        assert.equal(op.inventory_id, null);
        assert.equal(op.trade, null);
        const activity = await one(
          "select body from dmcrm_activities where id=$1",
          [q.activity_id],
        );
        for (const value of [
          "98765",
          "Loan balance",
          "27870",
          "9000",
          "Please call after 5.",
        ])
          assert.ok(activity.body.includes(value));
        assert.deepEqual(
          await one(
            "select (select count(*) from dmcrm_inventory) inventory,(select count(*) from dmcrm_trades) trades",
          ),
          before,
        );
        const finance = await submit(
          payload({
            kind: "finance",
            name: "Financing Example",
            phone: "2025550188",
            email: "finance@example.invalid",
            budget: "$300 monthly",
            downPayment: "1500",
            preferredContact: "Text message",
            contactNoticeVersion: "2026-09-07-inquiry-v1",
            smsConsent: "yes",
          }),
        );
        assert.equal(
          (
            await one(
              "select channel from dmcrm_tasks where opportunity_id=$1",
              [finance.opportunity_id],
            )
          ).channel,
          "call",
        );
        assert.match(
          (
            await one("select body from dmcrm_activities where id=$1", [
              finance.activity_id,
            ])
          ).body,
          /Down payment: 1500/,
        );
      },
    );
    await t.test(
      "failed imports retain website submissions and retry atomically without orphan profiles",
      async () => {
        await pg.exec(`create function reject_test_inquiry() returns trigger language plpgsql as $$begin if new.body like '%INJECT_IMPORT_FAILURE%' then raise exception 'test failure' using errcode='P0001';end if;return new;end$$;
        create trigger reject_test_inquiry before insert on dmcrm_activities for each row execute function reject_test_inquiry();`);
        const p = payload({
          name: "Retry Example",
          email: "retry@example.invalid",
          phone: "2025550199",
          message: "INJECT_IMPORT_FAILURE",
        });
        const q = await submit(p);
        assert.equal(q.state, "pending");
        assert.equal(q.attempts, 1);
        assert.equal(q.last_error_code, "P0001");
        assert.equal(
          await one(
            "select id from dmcrm_customers where email='retry@example.invalid'",
          ),
          undefined,
        );
        assert.ok(await one("select id from leads where id=$1", [p.requestId]));
        assert.ok(
          await one("select id from lead_notifications where lead_id=$1", [
            p.requestId,
          ]),
        );
        assert.equal((await feed()).websiteIntake?.pending, 1);
        await pg.exec(
          "drop trigger reject_test_inquiry on dmcrm_activities;drop function reject_test_inquiry();update dmcrm_website_intake set next_attempt_at=now() where state='pending';",
        );
        assert.equal((await feed()).websiteIntake?.pending, 0);
        const retried = await one(
          "select * from dmcrm_website_intake where id=$1",
          [p.requestId],
        );
        assert.equal(retried.state, "imported");
        assert.equal(retried.attempts, 2);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_customers where email='retry@example.invalid'",
              )
            ).n,
          ),
          1,
        );
      },
    );
    await t.test(
      "only form inquiries cross the bridge, and browser roles cannot read or invoke intake",
      async () => {
        const job = payload({
          kind: "employment",
          name: "Job Applicant",
          phone: "2025550177",
          email: "applicant@example.invalid",
        });
        assert.equal(await submit(job), undefined);
        const before = Number(
          (await one("select count(*) n from dmcrm_website_intake")).n,
        );
        await pg.query(
          "insert into messages(lead_id,direction,body,state,provider_id) values($1,'inbound','A later email reply','received','provider-reply-test')",
          [first.requestId],
        );
        assert.equal(
          Number((await one("select count(*) n from dmcrm_website_intake")).n),
          before,
        );
        await assert.rejects(
          () => feed(crypto.randomUUID()),
          /membership required/,
        );
        await pg.exec("set role anon");
        await assert.rejects(
          () => pg.query("select * from dmcrm_website_intake"),
          /permission denied/,
        );
        await assert.rejects(
          () =>
            pg.query("select dmcrm_import_website_inquiry($1)", [
              first.requestId,
            ]),
          /permission denied/,
        );
        await assert.rejects(
          () => pg.query("select dmcrm_attention($1,$2)", [org, owner]),
          /permission denied/,
        );
        await pg.exec("reset role;set role service_role");
        await assert.rejects(
          () =>
            pg.query("select dmcrm_queue_website_inquiry($1)", [
              inquiry.message_id,
            ]),
          /permission denied/,
        );
        await pg.exec("reset role");
      },
    );
  } finally {
    await pg.close();
  }
});

test("Overview identifies website requests, supports review, and surfaces queued imports", () => {
  const id = crypto.randomUUID();
  assert.ok(
    attentionCommand.safeParse({
      type: "review_attention",
      kind: "website",
      id,
    }).success,
  );
  const feed: AttentionFeed = {
    total: 1,
    websiteIntake: { connected: true, pending: 1 },
    items: [
      {
        id,
        key: `website:${id}`,
        kind: "website",
        customer_id: crypto.randomUUID(),
        customer_name: "Test Customer",
        opportunity_id: crypto.randomUUID(),
        channel: null,
        title: "Test drive request · 2020 Ford Fusion",
        detail: "Unassigned · Tomorrow at 3 PM",
        created_at: "2026-10-26T14:00:00Z",
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(AttentionCenter, {
      feed,
      error: "",
      busy: false,
      onOpen() {},
      onReview() {},
      onRefresh() {},
    }),
  );
  assert.match(html, /Website inquiry/);
  assert.match(html, /Mark reviewed: Test Customer/);
  assert.match(html, /1 website inquiry is waiting to import/);
  const connected = renderToStaticMarkup(
    createElement(AttentionCenter, {
      feed: { ...feed, websiteIntake: { connected: true, pending: 0 } },
      error: "",
      busy: false,
      onOpen() {},
      onReview() {},
      onRefresh() {},
    }),
  );
  assert.match(connected, /Website connected/);
});
