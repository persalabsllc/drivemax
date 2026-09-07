import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { db, photoUrl, staffSession } from "../../../../lib/backend";

export async function POST(request: Request) {
  if (!(await staffSession()))
    return Response.json(
      { error: "Sign in to upload photos." },
      { status: 401 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024)
    return Response.json(
      { error: "Choose a photo under 4 MB." },
      { status: 413 },
    );
  try {
    const form = await request.formData();
    const id = z.string().uuid().parse(form.get("vehicleId"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !file.size)
      return Response.json(
        { error: "Choose a JPG, PNG, or WebP photo under 4 MB." },
        { status: 400 },
      );
    const { data: vehicle, error } = await db()
      .from("vehicles")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error || !vehicle)
      return Response.json(
        { error: "Save the vehicle before adding photos." },
        { status: 400 },
      );
    const source = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40000000,
    });
    const meta = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || ""))
      return Response.json(
        { error: "Use JPG, PNG, or WebP photos." },
        { status: 400 },
      );
    const image = await source
      .rotate()
      .resize({
        width: 1800,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    const path = `${id}/${randomUUID()}.webp`;
    const uploaded = await db()
      .storage.from("vehicle-photos")
      .upload(path, image, { contentType: "image/webp", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const asset = await db()
      .from("vehicle_assets")
      .insert({ path, vehicle_id: id });
    if (asset.error) {
      await db().storage.from("vehicle-photos").remove([path]);
      throw asset.error;
    }
    return Response.json({ path, url: photoUrl(path) });
  } catch {
    return Response.json(
      {
        error: "Could not upload this photo. Try a smaller JPG, PNG, or WebP.",
      },
      { status: 400 },
    );
  }
}
