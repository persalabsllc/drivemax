import { timingSafeEqual } from "node:crypto";
import { db } from "../../../../lib/server";
import { dispatchEmail } from "../../../../lib/messaging";
import { dispatchPush } from "../../../../lib/push";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const secret = process.env.CRM_EMAIL_WORKER_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : ""),
    supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (
    !secret ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return new Response("Unauthorized", { status: 401 });
  if (process.env.VERCEL_ENV !== "production")
    return new Response("Production only", { status: 409 });
  const { error } = await db().rpc("dmcrm_workflow_prepare");
  if (error)
    return new Response("Workflow scheduler unavailable", { status: 503 });
  const [emailReady] = await Promise.all([
    dispatchEmail("d5a1c100-0000-4000-8000-000000000001"),
    dispatchPush(),
  ]);
  if (!emailReady)
    return new Response("Email transport unavailable", { status: 503 });
  await db()
    .from("dmcrm_workflow_health")
    .update({ last_worker_at: new Date().toISOString() })
    .eq("org_id", "d5a1c100-0000-4000-8000-000000000001");
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
