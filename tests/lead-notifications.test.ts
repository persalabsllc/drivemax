import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  CONTACT_NOTICE_VERSION,
  captureContactNotice,
} from "../lib/contact-notice";
import { leadSchema } from "../lib/inventory";
import {
  notificationMessage,
  type NotificationPayload,
} from "../lib/notification-message";
import {
  deliverNotification,
  type NotificationJob,
} from "../lib/notification-delivery";

const leadId = "17b95b06-8cfa-47d7-838a-d6daae4d71e1";
const example: NotificationPayload = {
  leadId,
  name: "Test Customer",
  email: "customer@example.com",
  phone: "252-555-0100",
  preferredContact: "Email",
  kind: "contact",
  details: {},
  body: "Please contact me.",
  subject: "",
  isReply: false,
};
const job: NotificationJob = {
  id: "56ad261c-88f1-44db-8e9b-4903de2c12d1",
  claim_token: "claim",
  attempts: 1,
  provider_id: null,
  payload: example,
};

test("every form and customer reply alerts sales, with the customer as Reply-To", () => {
  for (const kind of ["contact", "vehicle", "finance", "employment"])
    for (const isReply of [false, true]) {
      const message = notificationMessage({ ...example, kind, isReply });
      assert.equal(message.to, "sales@drivemaxusedcars.com");
      assert.equal(message.replyTo, example.email);
      assert.match(message.text, /252-555-0100/);
      assert.match(message.text, /Please contact me\./);
      assert.match(message.text, /control-room\?tab=leads&lead=17b95b06/);
    }
  const phoneOnly = notificationMessage({
    ...example,
    email: "",
    preferredContact: "Phone call",
  });
  assert.equal(phoneOnly.to, "sales@drivemaxusedcars.com");
  assert.equal(phoneOnly.replyTo, "sales@drivemaxusedcars.com");
  assert.match(phoneOnly.text, /Email: Not provided/);
  assert.match(phoneOnly.text, /Preferred contact: Phone call/);
});

test("purchase, financing, employment, and test-drive details survive in readable alerts", () => {
  const purchase = notificationMessage({
    ...example,
    kind: "vehicle",
    details: {
      purpose: "purchase-offer",
      sellerVin: "1HGCM82633A004352",
      sellerYear: "2018",
      sellerMake: "Toyota",
      sellerModel: "Camry",
      sellerMiles: "90000",
      condition: "Good",
      titleStatus: "Clean title",
      accidentHistory: "No known accidents",
      loanStatus: "Owned outright",
      askingPrice: "12000",
      sellerZip: "28560",
    },
  });
  assert.match(purchase.subject, /Sell your car request/);
  for (const value of [
    "1HGCM82633A004352",
    "90000",
    "12000",
    "28560",
    "Clean title",
    "Owned outright",
  ])
    assert.ok(purchase.text.includes(value));
  const finance = notificationMessage({
    ...example,
    kind: "finance",
    details: { vehicle: "Toyota Camry", downPayment: "$2,500–$4,999" },
  });
  assert.match(finance.text, /Planned down payment: \$2,500–\$4,999/);
  const employment = notificationMessage({
    ...example,
    kind: "employment",
    details: { position: "Sales" },
    body: "Five years of experience.",
  });
  assert.match(employment.text, /Position or area of interest: Sales/);
  assert.match(employment.text, /Five years of experience\./);
  for (const [purpose, label] of [
    ["test-drive", "Test-drive"],
    ["vehicle-update", "Availability update"],
    ["similar-vehicle", "Similar vehicle"],
  ]) {
    const vehicle = notificationMessage({
      ...example,
      kind: "vehicle",
      details: {
        purpose,
        originalVehicleVin: "1HGCM82633A004352",
        originalVehicleStock: "DM101",
        preferredVisit: "Saturday morning",
      },
    });
    assert.ok(vehicle.subject.includes(label));
    assert.match(vehicle.text, /Vehicle VIN: 1HGCM82633A004352/);
    assert.match(vehicle.text, /Stock number: DM101/);
  }
  const injection = notificationMessage({
    ...example,
    name: "Test\r\nBcc: attacker@example.com",
  });
  assert.doesNotMatch(injection.subject, /[\r\n]/);
  assert.equal(injection.to, "sales@drivemaxusedcars.com");
});

test("staff notifications distinguish SMS opt-in, decline, and missing consent", () => {
  for (const [smsConsent, expected] of [
    ["yes", "Yes — customer care texts only"],
    ["no", "No — do not send text messages"],
    ["not_provided", "Not provided — do not send text messages"],
  ]) {
    const message = notificationMessage({
      ...example,
      details: { smsConsent },
    });
    assert.ok(
      message.text.includes(`Customer care text message consent: ${expected}`),
    );
  }
});

test("delivery failures retain the alert for retry; accepted IDs reconcile without resending", async () => {
  const patches: Record<string, string | null>[] = [];
  const now = () => new Date("2026-10-19T12:00:00Z");
  const saved = async (patch: Record<string, string | null>) => {
    patches.push(patch);
  };
  assert.equal(
    await deliverNotification(job, {
      now,
      save: saved,
      send: async () => {
        throw new Error("provider unavailable");
      },
    }),
    false,
  );
  assert.equal(patches[0].state, "pending");
  assert.equal(patches[0].next_attempt_at, "2026-10-19T12:02:00.000Z");
  assert.equal(patches[0].claim_token, null);
  let sends = 0;
  assert.equal(
    await deliverNotification(job, {
      now,
      save: saved,
      send: async (message, key) => {
        sends++;
        assert.equal(message.to, "sales@drivemaxusedcars.com");
        assert.equal(key, `lead-alert-${job.id}`);
        return "accepted-id";
      },
    }),
    true,
  );
  assert.equal(patches[1].state, "sent");
  assert.equal(patches[1].provider_id, "accepted-id");
  await deliverNotification(
    { ...job, provider_id: "accepted-id" },
    {
      now,
      save: saved,
      send: async () => {
        sends++;
        throw new Error("must not resend");
      },
    },
  );
  assert.equal(sends, 1);
  let writes = 0;
  await deliverNotification(job, {
    now,
    send: async () => "accepted-id",
    save: async (patch) => {
      if (++writes === 1) throw new Error("database unavailable");
      assert.equal(patch.state, "pending");
      assert.equal(patch.provider_id, "accepted-id");
    },
  });
  assert.equal(writes, 2);
});

test("database queues all intake atomically, deduplicates retries, isolates claims, and protects customer data", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const migration of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await readFile(
          new URL(`../supabase/migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      );
    const payload = captureContactNotice(
      leadSchema.parse({
        requestId: leadId,
        kind: "contact",
        name: example.name,
        email: example.email,
        phone: example.phone,
        preferredContact: "Email",
        message: "Original inquiry",
        website: "",
        contactNoticeVersion: CONTACT_NOTICE_VERSION,
        smsConsent: "no",
      }),
      "2026-10-20T15:00:00.000Z",
    );
    for (const message of [
      "Original inquiry",
      "Altered retry must not replace the original",
    ])
      await pg.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify({ ...payload, message }),
      ]);
    const alerts = await pg.query<{ payload: NotificationPayload }>(
      "select payload from public.lead_notifications",
    );
    assert.equal(alerts.rows.length, 1);
    assert.equal(alerts.rows[0].payload.body, "Original inquiry");
    assert.equal(alerts.rows[0].payload.isReply, false);
    assert.equal(alerts.rows[0].payload.email, example.email);
    assert.equal(alerts.rows[0].payload.details.smsConsent, "no");
    assert.equal(
      alerts.rows[0].payload.details.contactNoticeVersion,
      CONTACT_NOTICE_VERSION,
    );
    assert.equal(
      alerts.rows[0].payload.details.contactNoticeSubmittedAt,
      "2026-10-20T15:00:00.000Z",
    );
    assert.match(
      notificationMessage(alerts.rows[0].payload).text,
      /No — do not send text messages/,
    );
    const savedConsent = await pg.query<{ details: Record<string, string> }>(
      "select details from public.leads where id=$1",
      [leadId],
    );
    assert.equal(savedConsent.rows[0].details.smsConsent, "no");
    assert.equal(
      savedConsent.rows[0].details.smsConsentText,
      "No, I do not want to receive any text messages from Drive Max Used Cars",
    );

    const claim = await pg.query<{ id: string; claim_token: string }>(
      "select * from public.claim_lead_notification($1)",
      [leadId],
    );
    assert.equal(claim.rows.length, 1);
    assert.ok(claim.rows[0].claim_token);
    assert.equal(
      (await pg.query("select * from public.claim_lead_notification(null)"))
        .rows.length,
      0,
    );
    await pg.query(
      "update public.lead_notifications set locked_at=now()-interval '6 minutes' where id=$1",
      [claim.rows[0].id],
    );
    const reclaimed = await pg.query<{ claim_token: string }>(
      "select * from public.claim_lead_notification(null)",
    );
    assert.notEqual(reclaimed.rows[0].claim_token, claim.rows[0].claim_token);
    const stale = await pg.query(
      "update public.lead_notifications set state='sent' where claim_token=$1 returning id",
      [claim.rows[0].claim_token],
    );
    assert.equal(stale.rows.length, 0);
    await pg.query(
      "update public.lead_notifications set state='sent' where claim_token=$1",
      [reclaimed.rows[0].claim_token],
    );
    assert.equal(
      (await pg.query("select * from public.claim_lead_notification(null)"))
        .rows.length,
      0,
    );

    // Imported customer replies notify sales; staff notes and outgoing messages do not.
    for (const direction of ["inbound", "outbound", "note"])
      await pg.query(
        "insert into public.messages(lead_id,direction,body,provider_id) values($1,$2,'Message body',$3)",
        [leadId, direction, `provider-${direction}`],
      );
    const reply = await pg.query<{ payload: NotificationPayload }>(
      "select payload from public.lead_notifications where state='pending'",
    );
    assert.equal(reply.rows.length, 1);
    assert.equal(reply.rows[0].payload.isReply, true);

    for (const [index, kind] of [
      "vehicle",
      "finance",
      "employment",
    ].entries()) {
      const id = `00000000-0000-4000-a000-00000000000${index}`;
      await pg.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify({
          ...payload,
          requestId: id,
          kind,
          purpose: kind === "vehicle" ? "purchase-offer" : undefined,
          sellerVin: "1HGCM82633A004352",
          message: "",
          experience: "Applicant experience",
        }),
      ]);
      const result = await pg.query<{ payload: NotificationPayload }>(
        "select payload from public.lead_notifications where lead_id=$1",
        [id],
      );
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].payload.kind, kind);
      if (kind === "vehicle")
        assert.equal(
          result.rows[0].payload.details.sellerVin,
          "1HGCM82633A004352",
        );
      if (kind === "employment")
        assert.equal(result.rows[0].payload.body, "Applicant experience");
    }
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      await assert.rejects(
        pg.query("select * from public.lead_notifications"),
        /permission denied/,
      );
      await assert.rejects(
        pg.query("select * from public.claim_lead_notification(null)"),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
  } finally {
    await pg.close();
  }
});
