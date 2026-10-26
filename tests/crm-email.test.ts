import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Resend } from "resend";
import {
  crmEmailPayload,
  deliverCRMEmail,
  EmailSendError,
  type CRMEmailJob,
} from "../lib/crm-email-delivery";
import { receivedEmailText } from "../lib/received-email-text";
import { replyCRMToken, replyLeadId } from "../lib/email-routing";
const job: CRMEmailJob = {
  message_id: "00000000-0000-4000-8000-000000000001",
  claim_token: "claim",
  recipient: "customer@example.invalid",
  subject: "Your quote",
  body: "Hi Jordan,\n\nHere is your quote.",
  sender_name: "Test Salesperson",
  reply_token: "00000000-0000-4000-8000-000000000002",
  provider_id: null,
  attachments: [
    {
      filename: "customer-quote.pdf",
      content: "JVBERi0=",
      content_type: "application/pdf",
    },
  ],
};
test("customer emails use the verified sender, unique reply route and already-rendered quote PDF", () => {
  const p = crmEmailPayload(
    job,
    "Drive Max <sales@drivemaxusedcars.com>",
    "inbound.resend.app",
  );
  assert.equal(
    p.from,
    "Test Salesperson at Drive Max <sales@drivemaxusedcars.com>",
  );
  assert.equal(p.reply_to, `crm+${job.reply_token}@inbound.resend.app`);
  assert.equal(p.to, job.recipient);
  assert.equal(p.text, job.body);
  assert.deepEqual(p.attachments, job.attachments);
  assert.equal("html" in p, false);
  assert.equal(
    replyCRMToken([p.reply_to], "inbound.resend.app"),
    job.reply_token,
  );
  assert.equal(
    replyCRMToken(
      [p.reply_to.replace("inbound.resend.app", "attacker.invalid")],
      "inbound.resend.app",
    ),
    null,
  );
  assert.equal(
    replyCRMToken(
      [p.reply_to, `crm+${job.message_id}@inbound.resend.app`],
      "inbound.resend.app",
    ),
    null,
  );
  assert.equal(
    replyLeadId(
      [`lead+${job.message_id}@inbound.resend.app`],
      "inbound.resend.app",
    ),
    job.message_id,
  );
});
test("provider accepted + database retry preserves the provider ID and does not send again", async () => {
  let sends = 0;
  const finishes: unknown[] = [];
  const ok = await deliverCRMEmail(job, {
    send: async (_, key) => {
      sends++;
      assert.equal(key, `crm-email-${job.message_id}`);
      return "accepted-id";
    },
    finish: async (state, id, error) => {
      finishes.push([state, id, error]);
      if (state === "sent") throw Error("database unavailable");
    },
  });
  assert.equal(ok, false);
  assert.equal(sends, 1);
  assert.deepEqual((finishes[1] as any[]).slice(0, 2), [
    "retry",
    "accepted-id",
  ]);
  await deliverCRMEmail(
    { ...job, provider_id: "accepted-id" },
    {
      send: async () => {
        throw Error("Must not resend");
      },
      finish: async (state, id) => {
        assert.equal(state, "sent");
        assert.equal(id, "accepted-id");
      },
    },
  );
});
test("network failures retry, permanent provider failures stop, and neither logs customer content", async () => {
  for (const retryable of [true, false]) {
    await deliverCRMEmail(job, {
      send: async () => {
        throw new EmailSendError(retryable);
      },
      finish: async (state, id, error) => {
        assert.equal(state, retryable ? "retry" : "failed");
        assert.equal(id, null);
        assert.ok(!error?.includes(job.recipient));
        assert.ok(!error?.includes(job.body));
      },
    });
  }
});
test("the provider verifier rejects altered, expired, and unsigned reply webhooks", () => {
  const secretBytes = Buffer.alloc(32, 7),
    secret = `whsec_${secretBytes.toString("base64")}`;
  const resend = new Resend("test-only"),
    id = "msg_test",
    timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: "fixture",
      from: job.recipient,
      to: [`crm+${job.reply_token}@inbound.resend.app`],
    },
  });
  const sign = (stamp: string) =>
    `v1,${createHmac("sha256", secretBytes).update(`${id}.${stamp}.${payload}`).digest("base64")}`;
  const verified = resend.webhooks.verify({
    payload,
    headers: { id, timestamp, signature: sign(timestamp) },
    webhookSecret: secret,
  });
  assert.equal(verified.type, "email.received");
  assert.throws(() =>
    resend.webhooks.verify({
      payload: payload.replace("fixture", "altered"),
      headers: { id, timestamp, signature: sign(timestamp) },
      webhookSecret: secret,
    }),
  );
  assert.throws(() =>
    resend.webhooks.verify({
      payload,
      headers: { id, timestamp: "1", signature: sign("1") },
      webhookSecret: secret,
    }),
  );
  assert.throws(() =>
    resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature: "" },
      webhookSecret: secret,
    }),
  );
});

test("HTML-only replies become readable text without scripts, images or hidden tracking loads", () => {
  const body = receivedEmailText({
    html: '<html><style>.x {display:none}</style><body><p>Hi &amp; thanks!</p><p>Tomorrow works.</p><img src="https://tracking.invalid/pixel"><script>alert(1)</script></body></html>',
    attachments: [{}],
  });
  assert.match(body, /Hi & thanks!/);
  assert.match(body, /Tomorrow works/);
  assert.match(body, /1 attachment/);
  assert.ok(!body.includes("alert("));
  assert.ok(!body.includes("tracking.invalid"));
  assert.ok(receivedEmailText({ text: "a".repeat(20000) }).length <= 16000);
});
