import { z } from "zod";
import { db, session } from "../../../../lib/server";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await session();
  if (!s) return new Response("Sign in required", { status: 401, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404, headers });
  const d = db(),
    { data: file, error } = await d
      .from("dmcrm_deal_files")
      .select("path,customer_id,opportunity_id")
      .eq("org_id", s.org_id)
      .eq("id", id)
      .eq("insurance_capture", true)
      .maybeSingle();
  if (error)
    return new Response("Insurance card unavailable", { status: 503, headers });
  if (!file) return new Response("Not found", { status: 404, headers });
  const permission = await d.rpc("dmcrm_insurance_access", {
    p_org: s.org_id,
    p_actor: s.user_id,
    p_customer: file.customer_id,
    p_opportunity: file.opportunity_id,
  });
  if (permission.error || permission.data !== true)
    return new Response("Access denied", { status: 403, headers });
  const image = await d.storage.from("dmcrm-deal-files").download(file.path);
  if (image.error || !image.data)
    return new Response("Insurance card unavailable", { status: 503, headers });
  return new Response(image.data, {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline; filename=Insurance-card.jpg",
    },
  });
}
