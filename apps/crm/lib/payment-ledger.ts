import "server-only";
import { db, type session } from "./server";
import { canAccessView, canDesk, canManage } from "./permissions";
import type { Payment, PaymentCommand } from "./payments";
import {
  cancelStripeIntent, createStripeIntent, getStripePublishableKey, hasUnsettledFunds, inspectStripeIntent, retrieveStripeIntent,
  type StripePaymentIntent,
} from "./stripe-payments";

type Actor = NonNullable<Awaited<ReturnType<typeof session>>>;
type PaymentRow = Payment & {
  org_id: string; stripe_intent_id: string | null; revision: number;
  archived_at: string | null; archived_by: string | null; replacement_id: string | null;
};
type ManageCommand = Extract<PaymentCommand, { action: "edit_amount" | "delete" }>;
type PaymentResult = { payment: Payment; client_secret?: string; publishable_key?: string; deleted?: true };
type PaymentRegister = { payments: Payment[]; page: number; total: number; configured: boolean; livemode: boolean | null };
const receiptColumns = "id,inventory_id,stock_number,vehicle_name,employee_id,employee_name,payer_name,purpose,amount_cents,status,paid_at,card_brand,card_last4,created_at,livemode";
const privateColumns = `org_id,stripe_intent_id,revision,archived_at,archived_by,replacement_id,${receiptColumns}` as const;
const pageSize = 25;

export class PaymentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function scopedPayments<T extends Payment>(s: Actor, columns: typeof privateColumns | typeof receiptColumns, count = false, includeArchived = false) {
  if (!canAccessView(s.role, "Payments")) throw new PaymentRequestError("Staff access is required.", 403);
  let query = db().from("dmcrm_card_payments")
    .select<string, T>(columns, count ? { count: "exact" } : undefined).eq("org_id", s.org_id);
  if (!canDesk(s.role)) query = query.eq("employee_id", s.staff_id);
  if (!includeArchived) query = query.is("archived_at", null);
  return query;
}

export async function listPayments(s: Actor, page: number): Promise<PaymentRegister> {
  const result = await scopedPayments<Payment>(s, receiptColumns, true)
    .order("created_at", { ascending: false }).order("id")
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (result.error?.code === "PGRST103" && page > 0) return listPayments(s, 0);
  if (result.error) throw new Error("Payment register unavailable");
  const key = getStripePublishableKey();
  return { payments: result.data, page, total: result.count ?? 0, configured: !!key,
    livemode: key ? key.startsWith("pk_live_") : null };
}

export async function getScopedPayment(s: Actor, id: string): Promise<Payment | null> {
  const result = await scopedPayments<Payment>(s, receiptColumns).eq("id", id).maybeSingle();
  if (result.error) throw new Error("Payment unavailable");
  return result.data;
}

function publicPayment(row: PaymentRow): Payment {
  const { org_id: _org, stripe_intent_id: _intent, revision: _revision,
    archived_at: _archived, archived_by: _actor, replacement_id: _replacement, ...payment } = row;
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
    : checked.status === "processing" || checked.status === "requires_capture" ? "processing"
    : checked.status === "requires_payment_method" && intent.last_payment_error ? "failed" : "pending";
  const result = await db().rpc("dmcrm_sync_card_payment", {
    p_org: row.org_id, p_id: row.id, p_revision: row.revision, p_intent: intent.id, p_status: status,
    p_live: checked.livemode, p_paid_at: status === "paid" ? checked.paid_at : null,
    p_brand: status === "paid" ? checked.card_brand : null, p_last4: status === "paid" ? checked.card_last4 : null,
  });
  if (result.error?.message.includes("payment_archived")) throw new PaymentRequestError("Payment not found.", 404);
  if (result.error) throw new Error("Unable to record the verified payment status");
  return result.data as PaymentRow;
}

async function findPayment(s: Actor, id: string, includeArchived = false) {
  const result = await scopedPayments<PaymentRow>(s, privateColumns, false, includeArchived).eq("id", id).maybeSingle();
  if (result.error) throw new Error("Payment unavailable");
  if (!result.data) throw new PaymentRequestError("Payment not found.", 404);
  return result.data;
}

const protectedPayment = () => new PaymentRequestError("A paid, authorized, or processing payment cannot be changed.", 409);

async function verifyUnpaid(row: PaymentRow, intent: StripePaymentIntent) {
  if (row.stripe_intent_id !== intent.id || row.livemode !== intent.livemode) throw new Error("Intent binding mismatch");
  const verified = inspectStripeIntent(row, intent);
  if (["succeeded", "processing", "requires_capture"].includes(verified.status)) {
    await sync(row, intent);
    throw protectedPayment();
  }
  if (hasUnsettledFunds(intent)) throw protectedPayment();
}

async function cancelBeforeChange(row: PaymentRow, intentId: string) {
  let intent = await retrieveStripeIntent(intentId);
  await verifyUnpaid(row, intent);
  if (intent.status !== "canceled") {
    try { intent = await cancelStripeIntent(intent); }
    catch {
      // A concurrent checkout may have completed, or Stripe may have canceled
      // the intent before the response was lost. Recover the actual outcome.
      intent = await retrieveStripeIntent(intentId);
    }
    await verifyUnpaid(row, intent);
    if (intent.status !== "canceled") throw new Error("Stripe did not confirm cancellation");
  }
  if (row.status !== "canceled") await sync(row, intent);
}

async function managePayment(s: Actor, command: ManageCommand, row: PaymentRow): Promise<PaymentResult> {
  if (row.employee_id !== s.staff_id && !canManage(s.role))
    throw new PaymentRequestError("Only the employee who started this payment or a dealership manager can change it.", 403);
  if (row.status === "paid" || row.status === "processing") throw protectedPayment();
  if (command.action === "edit_amount" && command.amount_cents === row.amount_cents)
    throw new PaymentRequestError("Enter a different payment amount.", 400);
  if (!row.archived_at && row.stripe_intent_id) {
    try { await cancelBeforeChange(row, row.stripe_intent_id); }
    catch (error) {
      // A concurrent change already archived this row. The RPC verifies which
      // operation won and replays only an identical request.
      if (!(error instanceof PaymentRequestError && error.status === 404)) throw error;
    }
  }
  const edit = command.action === "edit_amount";
  const result = await db().rpc("dmcrm_manage_card_payment", {
    p_org: s.org_id, p_actor: s.user_id, p_id: row.id, p_intent: row.stripe_intent_id,
    p_replacement: edit ? command.replacement_id : null, p_amount: edit ? command.amount_cents : null,
  });
  if (!result.error) {
    const payment = publicPayment(result.data as PaymentRow);
    return edit ? { payment } : { payment, deleted: true };
  }
  const message = result.error.message;
  if (message.includes("payment_binding_changed") && !row.stripe_intent_id) {
    // The first card-entry request bound the original intent while the draft
    // was being edited. A bound intent is immutable, so this retries only once.
    const bound = await findPayment(s, row.id, true);
    if (bound.stripe_intent_id) return managePayment(s, command, bound);
  }
  if (message.includes("payment_missing")) throw new PaymentRequestError("Payment not found.", 404);
  if (message.includes("payment_employee_denied")) throw new PaymentRequestError("Access to change this payment was denied.", 403);
  if (message.includes("payment_not_editable")) throw protectedPayment();
  if (message.includes("payment_retry_conflict") || message.includes("payment_binding_changed"))
    throw new PaymentRequestError("This payment has changed. Refresh the register to see its current entry.", 409);
  if (message.includes("payment_invalid_change")) throw new PaymentRequestError("Enter a different valid payment amount.", 400);
  throw new Error("Unable to save the payment change");
}

export async function runPaymentCommand(s: Actor, command: PaymentCommand): Promise<PaymentResult> {
  const key = getStripePublishableKey();
  if (!canAccessView(s.role, "Payments")) throw new PaymentRequestError("Staff access is required.", 403);
  if (command.action === "create" && !key)
    throw new PaymentRequestError("Stripe is not configured for this CRM yet.", 503);

  if (command.action === "edit_amount" || command.action === "delete")
    return managePayment(s, command, await findPayment(s, command.id, true));
  const row = command.action === "create" ? await reserve(s, command) : await findPayment(s, command.id);
  if (row.archived_at) throw new PaymentRequestError("Payment not found.", 404);
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
  if (command.action !== "verify" && (payment.status === "pending" || payment.status === "failed") && intent.client_secret)
    return { payment, client_secret: intent.client_secret, publishable_key: key };
  return { payment };
}

export async function reconcileStripeWebhook(orgId: string, paymentId: string, intentId: string) {
  const result = await db().from("dmcrm_card_payments").select<string, PaymentRow>(privateColumns)
    .eq("org_id", orgId).eq("id", paymentId).eq("stripe_intent_id", intentId).is("archived_at", null).maybeSingle();
  if (result.error) throw new Error("Payment lookup failed");
  const row = result.data;
  if (!row || row.status === "paid" || row.status === "canceled") return;
  try { await sync(row, await retrieveStripeIntent(intentId)); }
  catch (error) { if (!(error instanceof PaymentRequestError && error.status === 404)) throw error; }
}
