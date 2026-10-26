import { timingSafeEqual } from "node:crypto";
import { backendReady } from "../../../../lib/backend";
import { dispatchLeadNotificationsSafely } from "../../../../lib/lead-notifications";
import { dispatchCRMEmailsSafely } from "../../../../lib/crm-email";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (
    !secret ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return new Response("Unauthorized", { status: 401 });
  if (!backendReady()) return new Response("Not configured", { status: 503 });
  const [crm, result] = await Promise.all([
    dispatchCRMEmailsSafely(),
    dispatchLeadNotificationsSafely(),
  ]);
  return Response.json(
    { ...result, crm },
    {
      status:
        result.configured && result.pending === 0 && crm.pending === 0
          ? 200
          : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
