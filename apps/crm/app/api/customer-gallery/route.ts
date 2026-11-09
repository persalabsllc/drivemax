import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, session } from "../../../lib/server";
import { canManage } from "../../../lib/permissions";
import { galleryFields, galleryUpdate } from "../../../lib/customer-gallery";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const sameOrigin = (r: Request) =>
  r.headers.get("origin") === new URL(r.url).origin;
async function manager() {
  const s = await session();
  return s && canManage(s.role) ? s : null;
}

export async function GET() {
  try {
    const s = await manager();
    if (!s)
      return json(
        { error: "Sign in as a manager to manage website photos." },
        403,
      );
    const { data, error } = await db()
      .from("dmcrm_site_photos")
      .select("*")
      .eq("org_id", s.org_id)
      .order("sort_order")
      .order("id")
      .limit(500);
    if (error) throw error;
    const photos = await Promise.all(
      (data || []).map(
        async ({
          storage_path,
          seed_path,
          org_id: _org,
          created_at: _created,
          ...photo
        }) => {
          let preview = seed_path
            ? `https://www.drivemaxusedcars.com${seed_path}`
            : "";
          if (storage_path) {
            const result = await db()
              .storage.from("dmcrm-gallery")
              .createSignedUrl(storage_path, 600);
            if (result.error) throw result.error;
            preview = result.data.signedUrl;
          }
          return { ...photo, preview };
        },
      ),
    );
    return json({ photos });
  } catch {
    return json(
      { error: "Could not load the gallery. Please try again." },
      503,
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return json({ error: "Invalid request origin." }, 403);
    const s = await manager();
    if (!s)
      return json({ error: "Only managers can add website photos." }, 403);
    if (Number(request.headers.get("content-length")) > 4.3 * 1024 * 1024)
      return json({ error: "Choose a smaller photo." }, 413);
    const form = await request.formData();
    const parsed = galleryFields.safeParse(
      JSON.parse(String(form.get("fields") || "{}")),
    );
    if (!parsed.success)
      return json({ error: parsed.error.issues[0].message }, 400);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024)
      return json({ error: "Use a JPG, PNG or WebP under 4 MB." }, 400);
    const input = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40000000,
    });
    const meta = await input.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      return json({ error: "Use a still JPG, PNG or WebP photo." }, 400);
    const bytes = await input
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    const id = randomUUID(),
      path = `${s.org_id}/${id}.webp`;
    const upload = await db()
      .storage.from("dmcrm-gallery")
      .upload(path, bytes, { contentType: "image/webp", upsert: false });
    if (upload.error) throw upload.error;
    const saved = await db()
      .from("dmcrm_site_photos")
      .insert({ ...parsed.data, id, org_id: s.org_id, storage_path: path });
    if (saved.error) {
      await db().storage.from("dmcrm-gallery").remove([path]);
      throw saved.error;
    }
    return json({
      id,
      message: parsed.data.published
        ? "Photo published to the website."
        : "Photo saved as a draft.",
    });
  } catch {
    return json(
      { error: "Could not upload this photo. Try a smaller JPG, PNG or WebP." },
      400,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request))
      return json({ error: "Invalid request origin." }, 403);
    const s = await manager();
    if (!s)
      return json({ error: "Only managers can edit website photos." }, 403);
    const parsed = galleryUpdate.safeParse(await request.json());
    if (!parsed.success)
      return json({ error: parsed.error.issues[0].message }, 400);
    const { id, updated_at, fields } = parsed.data;
    const result = await db()
      .from("dmcrm_site_photos")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", s.org_id)
      .eq("updated_at", updated_at)
      .select("id")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      return json(
        {
          error:
            "This photo changed in another session. Refresh the gallery before saving.",
        },
        409,
      );
    return json({
      message: fields.published
        ? "Website photo updated."
        : "Photo saved; hidden from the website.",
    });
  } catch {
    return json({ error: "Could not save this photo. Please try again." }, 503);
  }
}
