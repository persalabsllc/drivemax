import { test } from "node:test";
import assert from "node:assert/strict";
import { crmEmailPayload, type CRMEmailJob } from "../lib/crm-email-delivery";
import { crmReviewEmailHtml } from "../lib/crm-review-email";
import { GOOGLE_WRITE_REVIEW_URL } from "../lib/reviews";

const preferences = "https://crm.drivemaxusedcars.com/email-preferences/00000000-0000-4000-8000-000000000001";
const body = `Hi Jordan,\n\nThank you for choosing Drive Max! Please share your experience in a Google review.\n\n${GOOGLE_WRITE_REVIEW_URL}\n\nKyle\nDrive Max Used Cars\n6210 Old US Hwy 70 West\nNew Bern, NC 28562\n\nEmail preferences: ${preferences}`;

test("sold review mail has a Google review button, branding and working preferences", () => {
  const html = crmReviewEmailHtml("Thank you for choosing Drive Max!", body)!;
  assert.ok(html);
  assert.match(html, /<a class="review-button"[^>]*target="_blank"[^>]*>Leave a Google review<\/a>/);
  assert.ok(html.includes(`href="${GOOGLE_WRITE_REVIEW_URL}"`));
  assert.ok(!html.includes(`>${GOOGLE_WRITE_REVIEW_URL}<`));
  assert.match(html, /<v:roundrect[^>]*href=/);
  assert.ok(html.includes(`href="${preferences}"`));
  assert.match(html, /alt="Drive Max Used Cars"/);
  assert.match(html, /bgcolor="#08182d"/);
  assert.match(html, /background-color:#ffda3e/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.equal((html.match(/<table\b/g) || []).length, (html.match(/<table[^>]+role="presentation"/g) || []).length);
});

test("personalization and signatures cannot inject HTML or arbitrary buttons", () => {
  const hostile = `<img src=x onerror=alert(1)> & "Alex"`;
  const html = crmReviewEmailHtml(hostile, body.replace("Jordan", hostile))!;
  assert.ok(!html.includes(hostile));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Alex&quot;/);
  assert.equal(crmReviewEmailHtml("hello", body.replace(GOOGLE_WRITE_REVIEW_URL, "https://example.invalid/review")), undefined);
  assert.equal(crmReviewEmailHtml("hello", `Quoted URL: ${GOOGLE_WRITE_REVIEW_URL}`), undefined);
});

test("HTML and plain-text alternatives share the same recipient, content and reply route", () => {
  const job: CRMEmailJob = {
    message_id: "00000000-0000-4000-8000-000000000001", claim_token: "test",
    recipient: "customer@example.invalid", subject: "Thank you for choosing Drive Max!",
    body, sender_name: "Drive Max team", reply_token: "00000000-0000-4000-8000-000000000002",
    provider_id: null, attachments: [],
  };
  const payload = crmEmailPayload(job, "Drive Max <sales@drivemaxusedcars.com>", "inbound.resend.app");
  assert.equal(payload.to, job.recipient);
  assert.equal(payload.text, body);
  assert.equal(payload.html, crmReviewEmailHtml(job.subject, body));
  assert.equal(payload.reply_to, `crm+${job.reply_token}@inbound.resend.app`);
});
