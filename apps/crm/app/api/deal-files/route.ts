import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, session } from "../../../lib/server";
import { canManage } from "../../../lib/model";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request" }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in to upload documents." }, 401);
  if (Number(req.headers.get("content-length")) > 4300000)
    return json({ error: "Choose a file smaller than 4 MB." }, 413);
  let uploaded: string | null = null;
  try {
    const form = await req.formData(),
      file = form.get("file"),
      cid = z.uuid().parse(form.get("customer_id")),
      oid = z.uuid().parse(form.get("opportunity_id")),
      kind = z
        .enum([
          "signed",
          "insurance",
          "identification",
          "stipulation",
          "packet",
          "other",
        ])
        .parse(form.get("kind"));
    if (!(file instanceof File) || file.size < 1 || file.size > 4194304)
      return json(
        { error: "Choose a PDF, JPG or PNG smaller than 4 MB." },
        400,
      );
    const d = db(),
      { data: o, error } = await d
        .from("dmcrm_opportunities")
        .select("id,customer_id,assigned_to")
        .eq("org_id", s.org_id)
        .eq("id", oid)
        .eq("customer_id", cid)
        .maybeSingle();
    if (error || !o || (!canManage(s.role) && o.assigned_to !== s.staff_id))
      return json({ error: "Assigned salesperson or manager required." }, 403);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const magic = Buffer.from(bytes.subarray(0, 8));
    const type =
      magic.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff
          ? "image/jpeg"
          : magic.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : null;
    if (!type)
      return json(
        { error: "Only PDF, JPG and PNG documents are supported." },
        400,
      );
    const id = crypto.randomUUID(),
      path = `${s.org_id}/${oid}/${id}.${type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg"}`,
      name =
        file.name.replace(/[\x00-\x1f\/\\]/g, "_").slice(0, 200) || "Document";
    const upload = await d.storage
      .from("dmcrm-deal-files")
      .upload(path, bytes, { contentType: type, upsert: false });
    if (upload.error) throw Error();
    uploaded = path;
    const saved = await d
      .from("dmcrm_deal_files")
      .insert({
        id,
        org_id: s.org_id,
        customer_id: cid,
        opportunity_id: oid,
        name,
        kind,
        size: file.size,
        mime: type,
        path,
        created_by: s.user_id,
      });
    if (saved.error) throw Error();
    uploaded = null;
    await d
      .from("dmcrm_activities")
      .insert({
        org_id: s.org_id,
        customer_id: cid,
        opportunity_id: oid,
        kind: "system",
        body: `${kind === "packet" ? "Finalized print packet archived" : "Document uploaded"}: ${name}`,
        created_by: s.name,
      });
    return json({ id });
  } catch {
    if (uploaded)
      await db().storage.from("dmcrm-deal-files").remove([uploaded]);
    return json({ error: "Document could not be saved. Try again." }, 400);
  }
}
