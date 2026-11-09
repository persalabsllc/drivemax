import { backendReady, db } from "../../../../../lib/backend";
import { GALLERY_ORG } from "../../../../../lib/customer-gallery-server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!backendReady() || !/^[a-f0-9-]{36}$/.test(id))
    return new Response(null, { status: 404 });
  const { data: photo, error } = await db()
    .from("dmcrm_site_photos")
    .select("storage_path")
    .eq("org_id", GALLERY_ORG)
    .eq("id", id)
    .eq("published", true)
    .maybeSingle();
  if (error || !photo?.storage_path)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const { data, error: storageError } = await db()
    .storage.from("dmcrm-gallery")
    .download(photo.storage_path);
  if (storageError || !data) return new Response(null, { status: 404 });
  return new Response(data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
