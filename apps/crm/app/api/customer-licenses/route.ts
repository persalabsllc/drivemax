import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, session } from "../../../lib/server";
import {
  licenseCropSchema,
  MAX_LICENSE_BYTES,
} from "../../../lib/license-scan";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
export async function GET(req: NextRequest) {
  const s = await session();
  if (!s) return json({ error: "Sign in required." }, 401);
  const parsed = z
    .uuid()
    .safeParse(req.nextUrl.searchParams.get("customer_id"));
  if (!parsed.success) return json({ error: "Customer required." }, 400);
  const d = db(),
    permission = await d.rpc("dmcrm_license_access", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_customer: parsed.data,
    });
  if (permission.error)
    return json({ error: "License files are temporarily unavailable." }, 503);
  if (permission.data !== true)
    return json({ error: "Assigned salesperson or manager required." }, 403);
  const { data, error } = await d
    .from("dmcrm_deal_files")
    .select("id,license_portrait,created_at")
    .eq("org_id", s.org_id)
    .eq("customer_id", parsed.data)
    .eq("license_capture", true)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error)
    return json(
      { error: "License file could not be loaded. Please retry." },
      503,
    );
  return json({ license: data });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request." }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in required." }, 401);
  if (Number(req.headers.get("content-length")) > MAX_LICENSE_BYTES + 65536)
    return json({ error: "License photo must be smaller than 3 MB." }, 413);
  try {
    const form = await req.formData(),
      id = z.uuid().parse(form.get("id")),
      customer = z.uuid().parse(form.get("customer_id"));
    const crop = licenseCropSchema.parse(JSON.parse(String(form.get("crop")))),
      file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_LICENSE_BYTES)
      return json({ error: "Choose a license photo smaller than 3 MB." }, 400);
    const d = db(),
      permission = await d.rpc("dmcrm_license_access", {
        p_org: s.org_id,
        p_actor: s.user_id,
        p_customer: customer,
      });
    if (permission.error)
      return json({ error: "License files are temporarily unavailable." }, 503);
    if (permission.data !== true)
      return json({ error: "Assigned salesperson or manager required." }, 403);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw Error("image");
    const { PDFDocument } = await import("pdf-lib");
    const image = await (await PDFDocument.create()).embedJpg(bytes);
    if (
      image.width < 200 ||
      image.height < 100 ||
      image.width > 4096 ||
      image.height > 4096
    )
      throw Error("image");
    const hash = createHash("sha256").update(bytes).digest("hex"),
      path = `${s.org_id}/licenses/${id}.jpg`,
      bucket = d.storage.from("dmcrm-deal-files");
    const uploaded = await bucket.upload(path, bytes, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "0",
    });
    if (uploaded.error) {
      // A retry may follow a lost successful response. Verify the immutable original.
      const original = await bucket.download(path);
      if (
        original.error ||
        !original.data ||
        createHash("sha256")
          .update(new Uint8Array(await original.data.arrayBuffer()))
          .digest("hex") !== hash
      )
        throw Error("upload");
    }
    const result = await d.rpc("dmcrm_save_license", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_customer: customer,
      p_id: id,
      p_size: bytes.length,
      p_sha256: hash,
      p_portrait: crop,
    });
    if (result.error) throw Error("filing");
    return json({ id: result.data });
  } catch {
    // Do not delete originals after an uncertain response; retries use the same ID.
    return json(
      {
        error:
          "The license photo could not be saved. Your customer is saved; retry the photo upload.",
      },
      400,
    );
  }
}
