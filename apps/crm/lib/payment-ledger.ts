import "server-only";
import { db, type session } from "./server";
import { canAccessView, canDesk } from "./permissions";
import type { Payment, PaymentCommand } from "./payments";
import {
  createStripeIntent, getStripePublishableKey, inspectStripeIntent, retrieveStripeIntent,
  type StripePaymentIntent,
} from "./stripe-payments";

type Actor = NonNullable<Awaited<ReturnType<typeof session>>>;
type PaymentRow = Payment & { org_id: string; stripe_intent_id: string | null; revision: number };
const receiptColumns = "id,inventory_id,stock_number,vehicle_name,employee_id,employee_name,payer_name,purpose,amount_cents,status,paid_at,card_brand,card_last4,created_at,livemode";
const privateColumns = `org_id,stripe_intent_id,revision,${receiptColumns}` as const;
const pageSize = 25;

export class PaymentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function scopedPayments(s: Actor, columns: typeof privateColumns | typeof receiptColumns, count = false) {
  if (!canAccessView(s.role, "Payments")) throw new PaymentRequestError("Staff access is required.", 403);
  let query = db().from("dmcrm_card_payments")
    .select(columns, count ? { count: "exact" } : undefined).eq("org_id", s.org_id);
  if (!canDesk(s.role)) query = query.eq("employee_id", s.staff_id);
  return query;
}

export async function listPayments(s: Actor, page: number) {
  const result = await scopedPayments(s, receiptColumns, true)
    .order("created_at", { ascending: false }).order("id")
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (result.error) throw new Error("Payment register unavailable");
  const key = getStripePublishableKey();
  return { payments: result.data as Payment[], total: result.count ?? 0, configured: !!key,
    livemode: key ? key.startsWith("pk_live_") : null };
}

export async function getScopedPayment(s: Actor, id: string): Promise<Payment | null> {
  const result = await scopedPayments(s, receiptColumns).eq("id", id).maybeSingle();
  if (result.error) throw new Error("Payment unavailable");
  return result.data as Payment | null;
}

function publicPayment(row: PaymentRow): Payment {
  const { org_id: _org, stripe_intent_id: _intent, revision: _revision, ...payment } = row;
  return payment;
}

async function reserve(s: Actor, command: Extract<PaymentCommand, {action:"create"}>): Promise<PaymentRow> {
  const result = await db().rpc("dmcrm_reserve_card_payment", {
    p_org: s.org_id, p_actor: s.user_id, p_data: command,
  });
  if (!result.error) return result.data as PaymentRow;
  const message = result.error.message;
  if (message.includes("payment_employee_denied"))
    throw new PaymentRequestError("Use the employee ID for your signed-in account.", 403);
  if (message.includes("payment_inventory_missing"))
    throw new PaymentRequestError("That stock number is no longer available. Refresh inventory.", 400);
  if (message.includes("payment_retry_conflict"))
    throw new PaymentRequestError("These details differ from the original payment. Reopen it in the payment register.", 409);
  throw new Error("Unable to reserve payment");
}

async function sync(row: PaymentRow, intent: StripePaymentIntent): Promise<PaymentRow> {
  if (row.stripe_intent_id && row.stripe_intent_id !== intent.id) throw new Error("Intent binding mismatch");
  const checked = inspectStripeIntent(row, intent);
  const status: Payment["status"] = checked.status === "succeeded" ? "paid"
    : checked.status === "canceled" ? "canceled"
    : checked.status === "processing" || checked.status === "requires_capture" ? "processing" : "pending";
  const result = await db().rpc("dmcrm_sync_card_payment", {
    p_org: row.org_id, p_id: row.id, p_revision: row.revision, p_intent: intent.id, p_status: status,
    p_live: checked.livemode, p_paid_at: status === "paid" ? checked.paid_at : null,
    p_brand: status === "paid" ? checked.card_brand : null, p_last4: status === "paid" ? checked.card_last4 : null,
  });
  if (result.error) throw new Error("Unable to record the verified payment status");
  return result.data as PaymentRow;
}

export async function runPaymentCommand(s: Actor, command: PaymentCommand) {
  const key = getStripePublishableKey();
  if (!canAccessView(s.role, "Payments")) throw new PaymentRequestError("Staff access is required.", 403);
  if (command.action === "create" && !key)
    throw new PaymentRequestError("Stripe is not configured for this CRM yet.", 503);

  let row: PaymentRow;
  if (command.action === "create") row = await reserve(s, command);
  else {
    const result = await scopedPayments(s, privateColumns).eq("id", command.id).maybeSingle();
    if (result.error) throw new Error("Payment unavailable");
    if (!result.data) throw new PaymentRequestError("Payment not found.", 404);
    row = result.data as PaymentRow;
  }
  if (command.action === "resume" && row.employee_id !== s.staff_id)
    throw new PaymentRequestError("The employee who started this payment can resume card entry.", 403);
  if (row.status === "paid" || row.status === "canceled") return { payment: publicPayment(row) };
  if (command.action === "verify" && !row.stripe_intent_id) return { payment: publicPayment(row) };
  if (!key) throw new PaymentRequestError("Stripe is not configured for this CRM yet.", 503);

  // Stripe's idempotency key protects intent creation on simultaneous requests.
  // We release the client secret only AFTER durably binding the one winning
  // intent. Even if an old idempotency key expires, a second intent can never be
  // confirmed through this payment once another intent has been bound.
  const intent = row.stripe_intent_id ? await retrieveStripeIntent(row.stripe_intent_id)
    : await createStripeIntent({ ...row, staff_id: row.employee_id });
  const synced = await sync(row, intent);
  if (synced.stripe_intent_id !== intent.id) throw new Error("Payment binding changed");
  const payment = publicPayment(synced);
  if (command.action !== "verify" && payment.status === "pending" && intent.client_secret)
    return { payment, client_secret: intent.client_secret, publishable_key: key };
  return { payment };
}

export async function reconcileStripeWebhook(orgId: string, paymentId: string, intentId: string) {
  const result = await db().from("dmcrm_card_payments").select(privateColumns)
    .eq("org_id", orgId).eq("id", paymentId).eq("stripe_intent_id", intentId).maybeSingle();
  if (result.error) throw new Error("Payment lookup failed");
  const row = result.data as PaymentRow | null;
  if (!row || row.status === "paid" || row.status === "canceled") return;
  await sync(row, await retrieveStripeIntent(intentId));
}
