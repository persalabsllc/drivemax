import { timingSafeEqual } from "node:crypto";
import {
  crmEmailReady,
  dispatchCRMEmailsSafely,
} from "../../../../lib/crm-email";
import { leadEmailFrom } from "../../../../lib/email-config";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
function authorized(request: Request) {
  const secret = process.env.CRM_EMAIL_WORKER_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || ""),
    expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  return (
    !!secret &&
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}
export async function GET(request: Request) {
  if (!authorized(request))
    return new Response("Unauthorized", { status: 401 });
  return Response.json(
    { connected: crmEmailReady(), sender: leadEmailFrom() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (!authorized(request))
    return new Response("Unauthorized", { status: 401 });
  if (!crmEmailReady()) return new Response("Not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 300)
    return new Response("Too large", { status: 413 });
  let id: string | undefined;
  try {
    const raw = await request.text();
    if (raw.length > 300) return new Response("Too large", { status: 413 });
    const input = JSON.parse(raw);
    id = input.id;
    if (
      id !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return new Response("Invalid request", { status: 400 });
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
  const result = await dispatchCRMEmailsSafely(id);
  return Response.json(result, {
    status: result.pending ? 202 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
