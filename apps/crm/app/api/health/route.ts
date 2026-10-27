import { db, ready } from "../../../lib/server";
export const dynamic = "force-dynamic";
// Public readiness only: no tenant data, queue contents, keys or customer identifiers.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!ready()) return Response.json({ ok: false }, { status: 503, headers });
  const { data, error } = await db()
    .from("dmcrm_workflow_health")
    .select("last_background_at,last_worker_at")
    .eq("org_id", "d5a1c100-0000-4000-8000-000000000001")
    .maybeSingle();
  if (error) return Response.json({ ok: false }, { status: 503, headers });
  const recent = (stamp: string | null) =>
    !!stamp && Date.now() - Date.parse(stamp) < 15 * 60000;
  return Response.json(
    {
      ok: true,
      backgroundScheduler: recent(data?.last_background_at)
        ? "healthy"
        : "waiting",
      deliveryWorker: recent(data?.last_worker_at) ? "healthy" : "waiting",
    },
    { headers },
  );
}
