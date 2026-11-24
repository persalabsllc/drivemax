import { limitedBody } from "../../../lib/webhook-security";
import { session } from "../../../lib/server";
import { listPayments, PaymentRequestError, runPaymentCommand } from "../../../lib/payment-ledger";
import { paymentCommandSchema } from "../../../lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const failure = (error: unknown) => error instanceof PaymentRequestError
  ? json({ error: error.message }, error.status)
  : json({ error: "The CRM could not confirm the payment status. Reopen the same payment and try again." }, 503);

export async function GET(request: Request) {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again to access payments." }, 401);
    const page = Number(new URL(request.url).searchParams.get("page") || 0);
    if (!Number.isInteger(page) || page < 0 || page > 100000) return json({ error: "Invalid page." }, 400);
    return json(await listPayments(s, page));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again to take a payment." }, 401);
    const raw = await limitedBody(request, 8000);
    let value: unknown;
    try { value = JSON.parse(raw.toString("utf8")); } catch { return json({ error: "Invalid payment request." }, 400); }
    const parsed = paymentCommandSchema.safeParse(value);
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    return json(await runPaymentCommand(s, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "too_large") return json({ error: "Request too large." }, 413);
    return failure(error);
  }
}
