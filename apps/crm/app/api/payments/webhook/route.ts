import { reconcileStripeWebhook } from "../../../../lib/payment-ledger";
import { stripeWebhookPayment, validStripeSignature } from "../../../../lib/stripe-payments";
import { limitedBody } from "../../../../lib/webhook-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Stripe webhook is not configured.", { status: 503 });
  try {
    const body = await limitedBody(request);
    if (!validStripeSignature(body, request.headers.get("stripe-signature") || "", secret)) {
      return new Response("Invalid signature.", { status: 400 });
    }
    const payment = stripeWebhookPayment(JSON.parse(body.toString("utf8")));
    if (payment) {
      await reconcileStripeWebhook(payment.orgId, payment.paymentId, payment.intentId);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SyntaxError) return new Response("Invalid event.", { status: 400 });
    if (error instanceof Error && error.message === "too_large") return new Response(null, { status: 413 });
    return new Response("Payment verification is temporarily unavailable.", { status: 503 });
  }
}
