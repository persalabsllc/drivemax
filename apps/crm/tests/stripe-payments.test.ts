import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import {
  createStripeIntent, getStripePublishableKey, inspectStripeIntent, retrieveStripeIntent,
  stripeWebhookPayment, validStripeSignature, type StripePaymentIntent,
} from "../lib/stripe-payments";

const payment = { id: randomUUID(), org_id: randomUUID(), amount_cents: 12550, stock_number: "DM-101", staff_id: randomUUID() };
const paid: StripePaymentIntent = {
  object: "payment_intent", id: "pi_fixture", status: "succeeded", livemode: false,
  currency: "usd", metadata: { dmcrm_org_id: payment.org_id, dmcrm_payment_id: payment.id },
  amount: 12550, amount_received: 12550, client_secret: "pi_fixture_secret_fixture",
  latest_charge: {
    object: "charge", created: 1700000000, payment_intent: "pi_fixture", amount_captured: 12550,
    currency: "usd", livemode: false, paid: true, captured: true,
    payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  },
};

function useFixtureKeys(t: TestContext) {
  for (const [name, value] of Object.entries({ STRIPE_SECRET_KEY: "rk_test_fixture", STRIPE_PUBLISHABLE_KEY: "pk_test_fixture" })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

test("payment retries send an identical idempotency key, USD amount, and CRM metadata to Stripe", async t => {
  useFixtureKeys(t);
  const requests: Request[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, options: RequestInit) => {
    requests.push(new Request(input, options));
    return Response.json(paid);
  });
  await Promise.all([createStripeIntent(payment), createStripeIntent(payment)]);
  assert.equal(requests[0].url, "https://api.stripe.com/v1/payment_intents");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.get("Idempotency-Key"), `dmcrm-payment-${payment.org_id}-${payment.id}`);
  assert.equal(requests[1].headers.get("Idempotency-Key"), requests[0].headers.get("Idempotency-Key"));
  const form = new URLSearchParams(await requests[0].text());
  assert.equal(form.get("amount"), "12550");
  assert.equal(form.get("currency"), "usd");
  assert.equal(form.get("payment_method_types[]"), "card");
  assert.equal(form.get("capture_method"), "automatic");
  assert.equal(form.get("metadata[dmcrm_org_id]"), payment.org_id);
  assert.equal(form.get("metadata[dmcrm_payment_id]"), payment.id);
  assert.equal(form.get("metadata[stock_number]"), payment.stock_number);
  assert.equal(form.get("metadata[employee_id]"), payment.staff_id);
  await retrieveStripeIntent(paid.id);
  assert.equal(requests[2].method, "GET");
  assert.equal(new URL(requests[2].url).searchParams.get("expand[]"), "latest_charge");
  await assert.rejects(retrieveStripeIntent("pi_different"), /different payment/);
  await assert.rejects(retrieveStripeIntent("pi_fixture/invalid"), /Invalid Stripe/);
  await assert.rejects(createStripeIntent({ ...payment, amount_cents: 49 }));
});

test("only the fully captured card payment matching the CRM record and Stripe mode can clear a receipt", t => {
  useFixtureKeys(t);
  assert.deepEqual(inspectStripeIntent(payment, paid), {
    status: "succeeded", card_brand: "visa", card_last4: "4242", paid_at: "2023-11-14T22:13:20.000Z", livemode: false,
  });
  for (const patch of [
    { amount: 12549 }, { amount_received: 12549 }, { currency: "cad" }, { livemode: true },
    { metadata: { ...paid.metadata, dmcrm_org_id: randomUUID() } },
    { metadata: { ...paid.metadata, dmcrm_payment_id: randomUUID() } },
    { latest_charge: null }, { latest_charge: { ...paid.latest_charge!, amount_captured: 12549 } },
    { latest_charge: { ...paid.latest_charge!, paid: false } }, { latest_charge: { ...paid.latest_charge!, payment_intent: "pi_other" } },
  ]) assert.throws(() => inspectStripeIntent(payment, { ...paid, ...patch }));
  for (const status of ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled"] as const) {
    assert.equal(inspectStripeIntent(payment, { ...paid, amount_received: 0, latest_charge: null, status }).paid_at, null);
  }
  assert.equal(getStripePublishableKey(), "pk_test_fixture");
  process.env.STRIPE_SECRET_KEY = "sk_live_fixture";
  assert.equal(getStripePublishableKey(), null);
  assert.throws(() => inspectStripeIntent(payment, paid));
});

test("Stripe webhook verifies the original bytes and delivery time, accepts rotated signatures and ignores unrelated events", () => {
  const payload = { object: "event", type: "payment_intent.succeeded", data: { object: paid } };
  const body = Buffer.from(JSON.stringify(payload));
  const time = 1700000000;
  const signature = createHmac("sha256", "test secret").update(time + ".").update(body).digest("hex");
  const header = `t=${time},v1=${"0".repeat(64)},v1=${signature}`;
  assert.ok(validStripeSignature(body, header, "test secret", time * 1000));
  assert.ok(!validStripeSignature(Buffer.concat([body, Buffer.from(" ")]), header, "test secret", time * 1000));
  assert.ok(!validStripeSignature(body, header, "another secret", time * 1000));
  assert.ok(!validStripeSignature(body, header, "test secret", (time + 301) * 1000));
  assert.deepEqual(stripeWebhookPayment(payload), { orgId: payment.org_id, paymentId: payment.id, intentId: paid.id });
  assert.equal(stripeWebhookPayment({ ...payload, type: "charge.succeeded" }), null);
  assert.equal(stripeWebhookPayment({ ...payload, data: { object: { ...paid, metadata: {} } } }), null);
});
