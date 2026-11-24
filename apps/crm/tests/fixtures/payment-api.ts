import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import type { TestContext } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import type { StripePaymentIntent } from "../../lib/stripe-payments";

// Run the real command handler and PostgreSQL functions in process. Only the
// provider and the PostgREST transport are substituted.
export async function paymentApi(t: TestContext, db: PGlite) {
  const guard = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "server-only") return next(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
    return next(specifier, context);
  } });
  const ledger = await import("../../lib/payment-ledger").finally(() => guard.deregister());
  for (const [name, value] of Object.entries({
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_PUBLISHABLE_KEY: "pk_test_fixture",
    NEXT_PUBLIC_SUPABASE_URL: "https://crm-fixture.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const intents = new Map<string, StripePaymentIntent>();
  const createKeys = new Map<string, string>();
  const cancelAttempts: string[] = [];
  let beforeCancel: ((intent: StripePaymentIntent) => void) | undefined;
  let failCancel = false;
  let beforeManage: (() => Promise<void>) | undefined;
  async function stripe(url: URL, request: Request) {
    if (request.method === "POST" && url.pathname === "/v1/payment_intents") {
      const key = request.headers.get("idempotency-key");
      assert.ok(key);
      const existing = createKeys.get(key);
      if (existing) return Response.json(intents.get(existing));
      const form = new URLSearchParams(await request.text());
      const id = "pi_" + randomUUID().replaceAll("-", "");
      const intent: StripePaymentIntent = {
        object: "payment_intent", id, client_secret: id + "_secret_fixture", currency: "usd",
        status: "requires_payment_method", amount: Number(form.get("amount")), amount_received: 0,
        capture_method: "automatic", amount_capturable: 0, payment_method_types: ["card"],
        latest_charge: null, livemode: false, metadata: {
          dmcrm_org_id: form.get("metadata[dmcrm_org_id]")!, dmcrm_payment_id: form.get("metadata[dmcrm_payment_id]")!,
        },
      };
      createKeys.set(key, id);
      intents.set(id, intent);
      return Response.json(intent);
    }
    const path = url.pathname.match(/^\/v1\/payment_intents\/(pi_[A-Za-z0-9]+)(\/cancel)?$/);
    assert.ok(path, url.pathname);
    const intent = intents.get(path[1]);
    assert.ok(intent);
    if (request.method === "GET" && !path[2]) return Response.json(intent);
    assert.equal(request.method, "POST");
    assert.equal(path[2], "/cancel");
    cancelAttempts.push(intent.id);
    beforeCancel?.(intent);
    beforeCancel = undefined;
    if (failCancel || ["succeeded", "processing", "canceled"].includes(intent.status))
      return Response.json({ error: { code: "payment_intent_unexpected_state" } }, { status: 400 });
    intent.status = "canceled";
    return Response.json(intent);
  }

  async function postgrest(url: URL, request: Request) {
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(dmcrm_[a-z_]+)$/);
    if (rpc) {
      const params = Object.entries(await request.json());
      const args = params.map(([name], i) => {
        assert.match(name, /^p_[a-z0-9_]+$/);
        return `${name} => $${i + 1}`;
      });
      try {
        if (beforeManage && rpc[1] === "dmcrm_manage_card_payment") {
          const callback = beforeManage;
          beforeManage = undefined;
          await callback();
        }
        const result = await db.query<{ payment: unknown }>(`select ${rpc[1]}(${args.join(",")}) as payment`,
          params.map(([, value]) => value && typeof value === "object" ? JSON.stringify(value) : value));
        return Response.json(result.rows[0].payment);
      } catch (error) {
        return Response.json({ message: (error as Error).message }, { status: 400 });
      }
    }
    assert.equal(url.pathname, "/rest/v1/dmcrm_card_payments");
    assert.equal(request.method, "GET");
    const columns = url.searchParams.get("select")!;
    assert.match(columns, /^[a-z0-9_,]+$/);
    const filters: string[] = [];
    const values: string[] = [];
    for (const [name, value] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(name)) continue;
      assert.match(name, /^[a-z_]+$/);
      if (value === "is.null") filters.push(name + " is null");
      else {
        assert.ok(value.startsWith("eq."));
        filters.push(`${name}=$${values.push(value.slice(3))}`);
      }
    }
    const where = filters.join(" and ");
    const { rows } = await db.query(`select ${columns} from dmcrm_card_payments where ${where} order by created_at desc,id`, values);
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || rows.length);
    if (offset > 0 && offset >= rows.length)
      return Response.json({ code: "PGRST103", message: "Requested range not satisfiable" }, { status: 416 });
    const page = rows.slice(offset, offset + limit);
    return Response.json(page, { headers: { "content-range": `*/${rows.length}` } });
  }
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.stripe.com") return stripe(url, request);
    assert.equal(url.hostname, "crm-fixture.invalid");
    return postgrest(url, request);
  });
  return {
    ...ledger, intents, cancelAttempts,
    beforeCancel(callback: (intent: StripePaymentIntent) => void) { beforeCancel = callback; },
    failCancellation(value: boolean) { failCancel = value; },
    beforeManageWrite(callback: () => Promise<void>) { beforeManage = callback; },
  };
}

export function capture(intent: StripePaymentIntent) {
  assert.ok(["requires_payment_method", "requires_confirmation"].includes(intent.status));
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = {
    object: "charge", payment_intent: intent.id, created: 1700000000, amount_captured: intent.amount,
    currency: "usd", paid: true, captured: true, livemode: false,
    payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  };
}
