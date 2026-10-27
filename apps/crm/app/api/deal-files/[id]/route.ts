import { NextRequest } from "next/server";
import { z } from "zod";
import { db, session } from "../../../../lib/server";
import { canManage } from "../../../../lib/model";
export const dynamic = "force-dynamic";
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await session();
  if (!s) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  const d = db(),
    { data: f, error } = await d
      .from("dmcrm_deal_files")
      .select("path,name,opportunity_id")
      .eq("org_id", s.org_id)
      .eq("id", id)
      .maybeSingle();
  if (error || !f) return new Response("Not found", { status: 404 });
  if (!canManage(s.role)) {
    const { data: o } = await d
      .from("dmcrm_opportunities")
      .select("assigned_to")
      .eq("org_id", s.org_id)
      .eq("id", f.opportunity_id)
      .maybeSingle();
    if (o?.assigned_to !== s.staff_id)
      return new Response("Access denied", { status: 403 });
  }
  const { data, error: e } = await d.storage
    .from("dmcrm-deal-files")
    .createSignedUrl(f.path, 60, { download: f.name });
  if (e || !data) return new Response("File unavailable", { status: 503 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: data.signedUrl,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
