import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Exercise the Next server module in Node's test runner. Replace only the
// framework's build-time client-import guard; provider traffic is stubbed below.
const serverImports = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
  return next(specifier, context);
} });

test("a retry, interrupted write, verify and reprint use one bound intent and never reveal a second client secret", async t => {
  const { runPaymentCommand, getScopedPayment, reconcileStripeWebhook } = await import("../lib/payment-ledger");
  serverImports.deregister();
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://crm-fixture.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture",
    SUPABASE_SERVICE_ROLE_KEY: "fixture", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_PUBLISHABLE_KEY: "pk_test_fixture",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }

  const actor = { user_id: "user1", staff_id: "staff1", org_id: "org1", name: "Employee", role: "sales" };
  const cmd = { action: "create" as const, id: "payment1", inventory_id: "vehicle1", employee_id: "staff1", payer_name: "Buyer",
    purpose: "Deposit", amount_cents: 15000 };
  const row = { ...cmd, org_id: actor.org_id, stock_number: "STK10", vehicle_name: "Car", employee_name: actor.name,
    stripe_intent_id: null as string | null, revision: 0, status: "pending", livemode: null as boolean|null,
    created_at: "2026-01-01T00:00:00Z", paid_at: null, card_brand: null, card_last4: null };
  const intent = { object: "payment_intent", id: "pi_fixture", status: "requires_payment_method", currency: "usd",
    amount: 15000, amount_received: 0, metadata: { dmcrm_org_id: actor.org_id, dmcrm_payment_id: cmd.id }, livemode: false,
    client_secret: "pi_fixture_secret_test", latest_charge: null as unknown };
  const keys = new Set<string>();
  let interruptBind = true;
  let stripeReads = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.stripe.com") {
      if (request.method === "POST") {
        keys.add(request.headers.get("idempotency-key") ?? "");
      } else {
        assert.equal(url.pathname, "/v1/payment_intents/pi_fixture");
        stripeReads++;
      }
      return Response.json(intent);
    }
    assert.equal(url.hostname, "crm-fixture.invalid");
    if (url.pathname.endsWith("/rpc/dmcrm_reserve_card_payment")) return Response.json(row);
    if (url.pathname.endsWith("/rpc/dmcrm_sync_card_payment")) {
      if (interruptBind) { interruptBind = false; return Response.json({ message: "fixture database failure" }, { status: 400 }); }
      const body = await request.json();
      assert.equal(body.p_id, cmd.id);
      assert.equal(body.p_org, actor.org_id);
      Object.assign(row, { stripe_intent_id: body.p_intent, livemode: body.p_live, status: body.p_status,
        paid_at: body.p_paid_at, card_brand: body.p_brand, card_last4: body.p_last4, revision: row.revision + 1 });
      return Response.json(row);
    }
    assert.equal(url.pathname, "/rest/v1/dmcrm_card_payments");
    const matches = ["id", "org_id", "employee_id", "stripe_intent_id"].every(field => {
      const filter = url.searchParams.get(field);
      return !filter || filter === "eq." + row[field as keyof typeof row];
    });
    const columns = url.searchParams.get("select")!.split(",");
    const result = Object.fromEntries(columns.map(key => [key, row[key as keyof typeof row]]));
    return Response.json(matches ? [result] : []);
  });

  await assert.rejects(runPaymentCommand(actor, cmd), /record the verified payment status/);
  const retry = await runPaymentCommand(actor, cmd);
  assert.ok(retry.client_secret);
  assert.equal(retry.payment.status, "pending");
  assert.equal(row.stripe_intent_id, intent.id);
  assert.deepEqual([...keys], ["dmcrm-payment-org1-payment1"]);
  assert.equal((await runPaymentCommand(actor, cmd)).client_secret, retry.client_secret);
  assert.equal((await runPaymentCommand(actor, { action: "resume", id: cmd.id })).client_secret, retry.client_secret);
  assert.equal((await runPaymentCommand(actor, { action: "verify", id: cmd.id })).client_secret, undefined);
  assert.equal(await getScopedPayment({ ...actor, staff_id: "other" }, cmd.id), null);
  assert.equal(await getScopedPayment({ ...actor, org_id: "other", role: "owner" }, cmd.id), null);
  await assert.rejects(runPaymentCommand({ ...actor, role: "manager", staff_id: "other" }, { action: "resume", id: cmd.id }), /employee who started/);

  intent.status = "succeeded";
  intent.amount_received = cmd.amount_cents;
  intent.latest_charge = { object: "charge", payment_intent: intent.id, created: 1700000000, amount_captured: cmd.amount_cents,
    currency: "usd", paid: true, captured: true, livemode: false, payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } } };
  await reconcileStripeWebhook(actor.org_id, cmd.id, "pi_other");
  assert.equal(row.status, "pending");
  await reconcileStripeWebhook(actor.org_id, cmd.id, intent.id);
  assert.equal(row.status, "paid");
  const reads = stripeReads;
  const verified = await runPaymentCommand(actor, { action: "verify", id: cmd.id });
  assert.equal(verified.client_secret, undefined);
  assert.equal(verified.payment.card_last4, "4242");
  assert.equal((await getScopedPayment(actor, cmd.id))?.status, "paid");
  assert.equal(stripeReads, reads);
});
