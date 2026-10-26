import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  starterEmailTemplates,
  emailTemplateSchema,
  renderEmailTemplate,
  appendSignature,
  personalSignature,
} from "../lib/email";
import { demoWorkspace } from "../lib/demo";
import { customerActivity } from "../lib/activity";
import { verifyEmail } from "../scripts/verify-email.mjs";
import { captureContactNotice } from "../../../lib/contact-notice";

const org = "d5a1c100-0000-4000-8000-000000000001",
  owner = "00000000-0000-4000-8000-000000000099",
  sales = "00000000-0000-4000-8000-000000000098",
  otherOrg = "00000000-0000-4000-8000-000000000097";
test("email template personalization is plain text, bounded, and handles missing vehicle details", () => {
  const ws = demoWorkspace(),
    c = {
      ...ws.customers[0],
      name: "Jordan {{phone}}",
      person: null,
      vehicle_interest: "",
    };
  for (const template of starterEmailTemplates)
    assert.equal(
      emailTemplateSchema.safeParse(template).success,
      true,
      template.name,
    );
  const rendered = renderEmailTemplate(
    { subject: "Hi {{customer_name}}", body: "{{vehicle}} / {{salesperson}}" },
    ws,
    c,
  );
  assert.equal(rendered.subject, "Hi Jordan {{phone}}");
  assert.match(rendered.body, /your next vehicle/);
  assert.match(
    appendSignature("Hello", personalSignature(ws)),
    /Kyle Kratoville/,
  );
  assert.equal(
    emailTemplateSchema.safeParse({
      ...starterEmailTemplates[0],
      body: "{{cost}}",
    }).success,
    false,
  );
  assert.equal(
    emailTemplateSchema.safeParse({
      ...starterEmailTemplates[0],
      subject: "hello\r\nBcc:bad@example.invalid",
    }).success,
    false,
  );
});

test("email database protects drafts, queues acknowledgments once, records replies, and preserves tenant permissions", async (t) => {
  const pg = new PGlite();
  const one = async (sql: string, params: unknown[] = []) =>
    (await pg.query<any>(sql, params)).rows[0];
  const command = async (p: unknown, actor = owner, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        actor,
        JSON.stringify(p),
      ])
    ).id;
  const makeCustomer = async (
    email = `${crypto.randomUUID()}@example.invalid`,
  ) =>
    await one(
      "insert into dmcrm_customers(org_id,name,email,phone,source) values($1,'Jordan Example',$2,'2025550100','Phone') returning *",
      [org, email],
    );
  const draft = async (
    customer: any,
    extra: Record<string, unknown> = {},
    actor = owner,
  ) => {
    const id = crypto.randomUUID();
    await command(
      {
        type: "save_message",
        id,
        revision: 0,
        customer_id: customer.id,
        opportunity_id: null,
        task_id: null,
        quote_id: null,
        channel: "email",
        recipient: customer.email,
        subject: "A personal reply",
        body: "Hello Jordan,\n\nHow can we help?",
        ...extra,
      },
      actor,
    );
    return await one("select * from dmcrm_messages where id=$1", [id]);
  };
  const queue = (
    id: string,
    rev = 0,
    actor = owner,
    attachments: unknown[] = [],
  ) =>
    one("select dmcrm_queue_email($1,$2,$3,$4,$5) id", [
      org,
      actor,
      id,
      rev,
      JSON.stringify(attachments),
    ]);
  const claim = (id: string | null = null) =>
    one("select * from dmcrm_email_claim($1)", [id]);
  const finish = (
    b: any,
    state = "sent",
    provider: string | null = crypto.randomUUID(),
  ) =>
    one("select dmcrm_email_finish($1,$2,$3,$4,$5) ok", [
      b.message_id,
      b.claim_token,
      state,
      provider,
      state === "sent" ? null : "Temporary delivery problem",
    ]);
  const submit = async (extra: Record<string, unknown> = {}) => {
    const p = captureContactNotice(
      {
        requestId: crypto.randomUUID(),
        kind: "contact",
        name: "Morgan Example",
        phone: "2025550133",
        preferredContact: "Email",
        email: `${crypto.randomUUID()}@example.invalid`,
        message: "Can you help me find a car?",
        smsConsent: "no",
        ...extra,
      },
      new Date().toISOString(),
    );
    await one("select submit_lead($1::jsonb)", [JSON.stringify(p)]);
    return p;
  };
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
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) < 14)
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const historical = await submit();
    await pg.exec(
      await fs.readFile(
        new URL("../db/014_email.sql", import.meta.url),
        "utf8",
      ),
    );
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales User','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales User','sales@example.invalid','sales');insert into dmcrm_orgs(id,name,slug) values('${otherOrg}','Other dealership','other-email');`,
    );

    await t.test(
      "starter templates match the UI and historical leads are not emailed",
      async () => {
        const rows = (
          await pg.query<any>(
            "select * from dmcrm_email_templates where org_id=$1",
            [org],
          )
        ).rows;
        assert.equal(rows.length, 13);
        for (const template of starterEmailTemplates) {
          const row = rows.find((r) => r.system_key === template.key);
          assert.equal(row.body, template.body);
          assert.equal(row.subject, template.subject);
        }
        assert.equal(await claim(), undefined);
        assert.equal(
          await one(
            "select * from dmcrm_email_autoreplies where intake_id=$1",
            [historical.requestId],
          ),
          undefined,
        );
      },
    );
    await t.test(
      "each real website inquiry imports before one personalized acknowledgment; retry does not duplicate",
      async () => {
        const p = await submit({ name: "Morgan Example" });
        const imported = await one(
          "select * from dmcrm_website_intake where id=$1",
          [p.requestId],
        );
        assert.equal(imported.state, "imported");
        const ar = await one(
          "select * from dmcrm_email_autoreplies where intake_id=$1",
          [p.requestId],
        );
        assert.equal(ar.state, "queued");
        const m = await one("select * from dmcrm_messages where id=$1", [
          ar.message_id,
        ]);
        assert.equal(m.customer_id, imported.customer_id);
        assert.equal(m.opportunity_id, imported.opportunity_id);
        assert.match(m.body, /Hi Morgan,/);
        assert.match(m.body, /team member will be in touch shortly/);
        assert.equal(m.status, "queued");
        await one("select submit_lead($1::jsonb)", [JSON.stringify(p)]);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_email_autoreplies where intake_id=$1",
                [p.requestId],
              )
            ).n,
          ),
          1,
        );
        const b = await claim(m.id);
        assert.equal(b.recipient, p.email);
        assert.equal(await claim(m.id), undefined);
        await finish(b);
        const again = await submit({ email: p.email });
        assert.equal(
          (
            await one(
              "select * from dmcrm_email_autoreplies where intake_id=$1",
              [again.requestId],
            )
          ).state,
          "skipped",
        );
      },
    );
    await t.test(
      "phone-only inquiries and disabled workflow do not send; re-enabling excludes the off period",
      async () => {
        const noEmail = await submit({
          email: "",
          preferredContact: "Phone call",
        });
        assert.equal(
          (
            await one(
              "select * from dmcrm_email_autoreplies where intake_id=$1",
              [noEmail.requestId],
            )
          ).reason,
          "No email address supplied",
        );
        const cfg = await one(
          "select * from dmcrm_email_settings where org_id=$1",
          [org],
        );
        await command({
          type: "save_email_settings",
          revision: cfg.revision,
          enabled: false,
          template_id: cfg.auto_reply_template_id,
          signature: cfg.auto_reply_signature,
        });
        const off = await submit();
        assert.equal(
          (
            await one(
              "select * from dmcrm_email_autoreplies where intake_id=$1",
              [off.requestId],
            )
          ).reason,
          "Workflow is off",
        );
        await command({
          type: "save_email_settings",
          revision: cfg.revision + 1,
          enabled: true,
          template_id: cfg.auto_reply_template_id,
          signature: cfg.auto_reply_signature,
        });
        assert.equal(await claim(), undefined);
      },
    );
    await t.test(
      "manager template CRUD uses revisions; signatures belong to the logged-in user",
      async () => {
        const id = crypto.randomUUID(),
          template = {
            name: "Custom response",
            category: "Other",
            subject: "Hi {{first_name}}",
            body: "Thank you, {{customer_name}}.",
          };
        await assert.rejects(
          command(
            { type: "save_email_template", id, revision: 0, template },
            sales,
          ),
          /Manager access/,
        );
        await command({
          type: "save_email_template",
          id,
          revision: 0,
          template,
        });
        await command({
          type: "save_email_template",
          id,
          revision: 0,
          template: { ...template, body: "An updated message." },
        });
        await assert.rejects(
          command({ type: "save_email_template", id, revision: 0, template }),
          /settings changed/,
        );
        await command({ type: "delete_email_template", id, revision: 1 });
        assert.equal(
          await one("select * from dmcrm_email_templates where id=$1", [id]),
          undefined,
        );
        const cfg = await one(
          "select * from dmcrm_email_settings where org_id=$1",
          [org],
        );
        await assert.rejects(
          command({
            type: "delete_email_template",
            id: cfg.auto_reply_template_id,
            revision: 0,
          }),
          /another automatic reply/,
        );
        await command(
          {
            type: "save_email_signature",
            revision: 0,
            body: "Sales User\nMy phone",
            user_id: owner,
          },
          sales,
        );
        assert.equal(
          (
            await one(
              "select * from dmcrm_email_signatures where org_id=$1 and user_id=$2",
              [org, sales],
            )
          ).body,
          "Sales User\nMy phone",
        );
        assert.equal(
          await one(
            "select * from dmcrm_email_signatures where org_id=$1 and user_id=$2",
            [org, owner],
          ),
          undefined,
        );
        await command(
          { type: "save_email_signature", revision: 0, body: "Updated" },
          sales,
        );
        await assert.rejects(
          command(
            { type: "save_email_signature", revision: 0, body: "Stale" },
            sales,
          ),
          /settings changed/,
        );
      },
    );
    await t.test(
      "old drafts stay unsent; Send checks revision/ownership and freezes one payload",
      async () => {
        const c = await makeCustomer(),
          m = await draft(c);
        assert.equal(await claim(m.id), undefined);
        await assert.rejects(queue(m.id, 1), /Draft changed/);
        await assert.rejects(queue(m.id, 0, sales), /Draft unavailable/);
        await queue(m.id);
        await queue(m.id);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_email_outbox where message_id=$1",
                [m.id],
              )
            ).n,
          ),
          1,
        );
        await assert.rejects(
          command({
            type: "save_message",
            id: m.id,
            revision: 1,
            customer_id: c.id,
            opportunity_id: null,
            task_id: null,
            quote_id: null,
            channel: "email",
            recipient: c.email,
            subject: "Changed",
            body: "Changed",
          }),
          /unsent drafts/,
        );
        const b = await claim(m.id);
        assert.equal(b.body, m.body);
        await finish(b);
      },
    );
    await t.test(
      "delivery races and duplicate events reconcile without changing failure into delivered",
      async () => {
        const c = await makeCustomer(),
          m = await draft(c);
        await queue(m.id);
        const b = await claim(m.id),
          pid = crypto.randomUUID();
        assert.equal(
          (await one("select dmcrm_email_delivery($1,'delivered') ok", [pid]))
            .ok,
          false,
        );
        await finish(b, "sent", pid);
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [m.id]))
            .status,
          "delivered",
        );
        await one("select dmcrm_email_delivery($1,'complained')", [pid]);
        await one("select dmcrm_email_delivery($1,'delivered')", [pid]);
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [m.id]))
            .status,
          "failed",
        );
        const next = await draft(c);
        await assert.rejects(queue(next.id), /stopped for this recipient/);
      },
    );
    await t.test(
      "verified replies require the recipient and secret route, deduplicate, and create activity/overview alerts",
      async () => {
        const c = await makeCustomer(),
          m = await draft(c);
        await queue(m.id);
        const b = await claim(m.id);
        await finish(b);
        const pid = crypto.randomUUID();
        const receive = (from: string, token = b.reply_token) =>
          one("select dmcrm_email_receive($1,$2,$3,$4,$5,now()) ok", [
            token,
            pid,
            from,
            "Re: A personal reply",
            "Yes, tomorrow works.",
          ]);
        assert.equal((await receive("stranger@example.invalid")).ok, false);
        assert.equal((await receive(c.email, crypto.randomUUID())).ok, false);
        assert.equal((await receive(c.email)).ok, true);
        await receive(c.email);
        const replies = (
          await pg.query<any>(
            "select * from dmcrm_messages where provider_id=$1",
            [pid],
          )
        ).rows;
        assert.equal(replies.length, 1);
        const feed = (
          await one("select dmcrm_attention($1,$2) f", [org, owner])
        ).f;
        assert.ok(
          feed.items.some(
            (i: any) => i.kind === "reply" && i.id === replies[0].id,
          ),
        );
        const ws = demoWorkspace();
        ws.customers = [c];
        ws.messages = replies;
        assert.ok(
          customerActivity(ws, c.id).some((e) =>
            e.body.includes("tomorrow works"),
          ),
        );
      },
    );
    await t.test(
      "expired retries never resend; known accepted provider IDs survive bookkeeping failures",
      async () => {
        const c = await makeCustomer(),
          m = await draft(c);
        await queue(m.id);
        const b = await claim(m.id);
        await finish(b, "retry", "accepted-provider");
        await pg.query(
          "update dmcrm_email_outbox set next_attempt_at=now() where message_id=$1",
          [m.id],
        );
        const again = await claim(m.id);
        assert.equal(again.provider_id, "accepted-provider");
        await finish(again, "sent", "accepted-provider");
        const old = await draft(c);
        await queue(old.id);
        await pg.query(
          "update dmcrm_email_outbox set first_attempt_at=now()-interval '24 hours' where message_id=$1",
          [old.id],
        );
        assert.equal(await claim(old.id), undefined);
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [old.id]))
            .status,
          "failed",
        );
      },
    );
    await t.test(
      "customer email stop is checked again before delivery and preserved in history",
      async () => {
        const c = await makeCustomer(),
          m = await draft(c);
        await queue(m.id);
        await command({
          type: "set_email_opt_out",
          customer_id: c.id,
          opted_out: true,
        });
        assert.equal(await claim(m.id), undefined);
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [m.id]))
            .status,
          "failed",
        );
        assert.match(
          (
            await one(
              "select body from dmcrm_activities where customer_id=$1 order by created_at desc limit 1",
              [c.id],
            )
          ).body,
          /stopped at customer request/,
        );
        await command({
          type: "set_email_opt_out",
          customer_id: c.id,
          opted_out: false,
        });
        const allowed = await draft(c);
        await queue(allowed.id);
        await finish(await claim(allowed.id));
      },
    );
    await t.test(
      "Control Room incoming and outgoing mail reaches the linked CRM history exactly once",
      async () => {
        const p = await submit();
        const imported = await one(
          "select * from dmcrm_website_intake where id=$1",
          [p.requestId],
        );
        const id = crypto.randomUUID(),
          pid = crypto.randomUUID();
        await pg.query(
          "insert into messages(id,lead_id,direction,body,subject,state,provider_id) values($1,$2,'inbound','A website email reply','Re: inquiry','received',$3)",
          [id, p.requestId, pid],
        );
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [id]))
            .customer_id,
          imported.customer_id,
        );
        await pg.query("update messages set state='received' where id=$1", [
          id,
        ]);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_messages where provider_id=$1",
                [pid],
              )
            ).n,
          ),
          1,
        );
        const outbound = crypto.randomUUID();
        await pg.query(
          "insert into messages(id,lead_id,direction,body,subject,recipient,state,staff_id) values($1,$2,'outbound','Thanks for writing','Re: inquiry',$3,'pending',$4)",
          [outbound, p.requestId, p.email, owner],
        );
        assert.equal(
          await one("select * from dmcrm_messages where id=$1", [outbound]),
          undefined,
        );
        await pg.query(
          "update messages set state='sent',provider_id=$2 where id=$1",
          [outbound, crypto.randomUUID()],
        );
        assert.equal(
          (await one("select * from dmcrm_messages where id=$1", [outbound]))
            .status,
          "sent",
        );
      },
    );

    await t.test(
      "early website delivery events reconcile when senders later save provider IDs",
      async () => {
        const p = await submit();
        const mid = crypto.randomUUID(),
          pid = crypto.randomUUID();
        await one("select dmcrm_email_delivery($1,'complained')", [pid]);
        await pg.query(
          "insert into messages(id,lead_id,direction,body,subject,recipient,state,staff_id) values($1,$2,'outbound','Hello','Reply',$3,'pending',$4)",
          [mid, p.requestId, p.email, owner],
        );
        await pg.query(
          "update messages set state='sent',provider_id=$2 where id=$1",
          [mid, pid],
        );
        assert.equal(
          (await one("select state from messages where id=$1", [mid])).state,
          "complained",
        );
        assert.equal(
          (await one("select status from dmcrm_messages where id=$1", [mid]))
            .status,
          "failed",
        );
        const notification = await one(
          "select id from lead_notifications where lead_id=$1 limit 1",
          [p.requestId],
        );
        const notifyPid = crypto.randomUUID();
        await one("select dmcrm_email_delivery($1,'bounced')", [notifyPid]);
        await pg.query(
          "update lead_notifications set provider_id=$2 where id=$1",
          [notification.id, notifyPid],
        );
        assert.match(
          (
            await one("select last_error from lead_notifications where id=$1", [
              notification.id,
            ])
          ).last_error,
          /bounced/,
        );
      },
    );
    await t.test(
      "production verification rolls back every message, customer, template and acknowledgment",
      async () => {
        const before = await one(
          "select (select count(*) from dmcrm_messages) messages,(select count(*) from dmcrm_email_templates) templates,(select count(*) from dmcrm_email_outbox) outbox",
        );
        await pg.exec("begin");
        await verifyEmail({
          query: (sql: string, values: unknown[] = []) => pg.query(sql, values),
        });
        await pg.exec("commit");
        const after = await one(
          "select (select count(*) from dmcrm_messages) messages,(select count(*) from dmcrm_email_templates) templates,(select count(*) from dmcrm_email_outbox) outbox",
        );
        assert.deepEqual(after, before);
      },
    );
    await t.test(
      "browser roles and other tenants cannot access outbox, tokens, or mutate settings",
      async () => {
        await assert.rejects(
          command(
            { type: "save_email_signature", revision: 0, body: "Intruder" },
            owner,
            otherOrg,
          ),
          /membership required/,
        );
        for (const role of ["anon", "authenticated"]) {
          await pg.exec(`set role ${role}`);
          await assert.rejects(
            pg.query("select * from dmcrm_email_outbox"),
            /permission denied/,
          );
          await assert.rejects(
            pg.query("select dmcrm_email_claim(null)"),
            /permission denied/,
          );
          await assert.rejects(
            pg.query("select dmcrm_queue_email($1,$2,$3,0)", [
              org,
              owner,
              crypto.randomUUID(),
            ]),
            /permission denied/,
          );
          await pg.exec("reset role");
        }
      },
    );
  } finally {
    await pg.close();
  }
});
