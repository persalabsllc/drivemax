import { createHmac } from "node:crypto";
import { z } from "zod";
import { equalSecret } from "./webhook-security";

export type StripePaymentBinding = {
  id: string;
  org_id: string;
  amount_cents: number;
  stock_number?: string;
  staff_id?: string;
};

const intentId = z.string().regex(/^pi_[A-Za-z0-9]+$/).max(255);
const statuses = z.enum([
  "requires_payment_method", "requires_confirmation", "requires_action",
  "processing", "requires_capture", "canceled", "succeeded",
]);
const chargeSchema = z.object({
  object: z.literal("charge"),
  payment_intent: z.string(),
  created: z.number().int().positive(),
  amount_captured: z.number().int(),
  currency: z.string(),
  paid: z.boolean(),
  captured: z.boolean(),
  livemode: z.boolean(),
  payment_method_details: z.object({
    type: z.string(),
    card: z.object({ brand: z.string().nullable(), last4: z.string().regex(/^\d{4}$/).nullable() }).nullish(),
  }).nullable(),
});
const intentSchema = z.object({
  object: z.literal("payment_intent"),
  id: intentId,
  status: statuses,
  amount: z.number().int(),
  amount_received: z.number().int(),
  amount_capturable: z.number().int().optional(),
  capture_method: z.string().optional(),
  payment_method_types: z.array(z.string()).optional(),
  payment_method_options: z.object({
    card: z.object({ capture_method: z.string().nullish() }).nullish(),
  }).nullish(),
  last_payment_error: z.object({}).nullish(),
  currency: z.string(),
  livemode: z.boolean(),
  metadata: z.record(z.string(), z.string()),
  client_secret: z.string().nullable(),
  latest_charge: chargeSchema.nullable(),
});
export type StripePaymentIntent = z.infer<typeof intentSchema>;

function keyMode(key?: string) {
  return key?.match(/^(?:pk|sk|rk)_(test|live)_[A-Za-z0-9_]+$/)?.[1];
}

function secretKey() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(?:sk|rk)_/.test(key) || !keyMode(key)) {
    throw new Error("Stripe payments are not configured.");
  }
  return key;
}

export function getStripePublishableKey() {
  const key = (process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)?.trim();
  if (!key?.startsWith("pk_") || !keyMode(key)) return null;
  try { return keyMode(key) === keyMode(secretKey()) ? key : null; }
  catch { return null; }
}

function checkAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 50 || amount > 99999999) {
    throw new Error("Enter an amount between $0.50 and $999,999.99.");
  }
}

async function stripeRequest(path: string, form?: URLSearchParams, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    "Stripe-Version": "2024-06-20",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/payment_intents${path}`, {
    method: form ? "POST" : "GET",
    headers,
    body: form,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Stripe could not confirm this request. Check the payment again.");
  const result = intentSchema.safeParse(await response.json());
  if (!result.success) throw new Error("Stripe returned an incomplete payment record.");
  return result.data;
}

export async function createStripeIntent(payment: StripePaymentBinding) {
  checkAmount(payment.amount_cents);
  const form = new URLSearchParams({
    amount: String(payment.amount_cents),
    currency: "usd",
    "payment_method_types[]": "card",
    capture_method: "automatic",
    "metadata[dmcrm_payment_id]": payment.id,
    "metadata[dmcrm_org_id]": payment.org_id,
    "expand[]": "latest_charge",
    description: "Drive Max CRM payment",
  });
  if (payment.stock_number) form.set("metadata[stock_number]", payment.stock_number);
  if (payment.staff_id) form.set("metadata[employee_id]", payment.staff_id);
  return stripeRequest("", form, `dmcrm-payment-${payment.org_id}-${payment.id}`);
}

export async function retrieveStripeIntent(id: string) {
  if (!intentId.safeParse(id).success) throw new Error("Invalid Stripe payment reference.");
  const intent = await stripeRequest(`/${id}?expand%5B%5D=latest_charge`);
  if (intent.id !== id) throw new Error("Stripe returned a different payment.");
  return intent;
}

// All checkouts created by this CRM use automatically captured cards. Other
// methods can be canceled during processing, and canceling an authorization
// releases held funds. Require the same configuration before canceling.
export function hasUnsettledFunds(intent: StripePaymentIntent) {
  return intent.amount_received !== 0 || intent.amount_capturable !== 0 ||
    !!intent.latest_charge && (intent.latest_charge.amount_captured !== 0 || intent.latest_charge.paid);
}

export async function cancelStripeIntent(intent: StripePaymentIntent) {
  if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status) ||
      hasUnsettledFunds(intent) || intent.capture_method !== "automatic" ||
      intent.payment_method_options?.card?.capture_method === "manual" ||
      intent.payment_method_types?.length !== 1 || intent.payment_method_types[0] !== "card") {
    throw new Error("Stripe has not confirmed an unpaid card attempt eligible for cancellation.");
  }
  const canceled = await stripeRequest(`/${intent.id}/cancel`,
    new URLSearchParams({ "expand[]": "latest_charge", cancellation_reason: "abandoned" }),
    `dmcrm-payment-cancel-${intent.id}`);
  if (canceled.id !== intent.id) throw new Error("Stripe returned a different payment.");
  return canceled;
}

export function inspectStripeIntent(payment: StripePaymentBinding, intent: StripePaymentIntent) {
  const live = keyMode(secretKey()) === "live";
  if (
    intent.livemode !== live || intent.currency !== "usd" || intent.amount !== payment.amount_cents ||
    intent.metadata.dmcrm_org_id !== payment.org_id || intent.metadata.dmcrm_payment_id !== payment.id
  ) throw new Error("The Stripe payment does not match this CRM entry.");

  if (intent.status !== "succeeded") {
    return { status: intent.status, card_brand: null, card_last4: null, paid_at: null, livemode: live };
  }

  const charge = intent.latest_charge;
  if (
    intent.amount_received !== payment.amount_cents || !charge || charge.payment_intent !== intent.id ||
    charge.livemode !== live || charge.currency !== "usd" || charge.amount_captured !== payment.amount_cents ||
    !charge.paid || !charge.captured || charge.payment_method_details?.type !== "card" || !charge.payment_method_details.card
  ) throw new Error("Stripe has not verified a matching captured card payment.");
  return {
    status: intent.status,
    card_brand: charge.payment_method_details.card.brand,
    card_last4: charge.payment_method_details.card.last4,
    paid_at: new Date(charge.created * 1000).toISOString(),
    livemode: live,
  };
}

export function validStripeSignature(body: Buffer, header: string, secret: string, now = Date.now()) {
  const parts = header.split(",").map(p => p.trim());
  const timestamps = parts.filter(p => p.startsWith("t="));
  if (!secret || timestamps.length !== 1) return false;
  const timestamp = timestamps[0].slice(2);
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const signature = createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex");
  return parts.some(p => /^v1=[0-9a-f]{64}$/.test(p) && equalSecret(p.slice(3), signature));
}

const relevantEvent = z.object({
  object: z.literal("event"),
  type: z.enum(["payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed", "payment_intent.canceled"]),
  data: z.object({
    object: z.object({
      object: z.literal("payment_intent"),
      id: intentId,
      metadata: z.object({ dmcrm_org_id: z.uuid(), dmcrm_payment_id: z.uuid() }),
    }),
  }),
});

export function stripeWebhookPayment(event: unknown) {
  const result = relevantEvent.safeParse(event);
  if (!result.success) return null;
  const { id, metadata } = result.data.data.object;
  return { orgId: metadata.dmcrm_org_id, paymentId: metadata.dmcrm_payment_id, intentId: id };
}
