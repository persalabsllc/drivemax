import { canReadDealFile } from "../../../lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, session } from "../../../lib/server";
import {
  prepareDocumentSchema,
  documentMime,
} from "../../../lib/vault-documents";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const s = await session();
  if (!s) return json({ error: "Sign in required." }, 401);
  const d = db(),
    pending = await d
      .from("dmcrm_document_uploads")
      .select("id,name,path,size,opportunity_id,kind")
      .eq("org_id", s.org_id)
      .eq("created_by", s.user_id)
      .is("completed_at", null)
      .gte("created_at", new Date(Date.now() - 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
  if (pending.error)
    return json({ error: "Pending uploads are temporarily unavailable." }, 503);
  const files = await Promise.all(
    (pending.data ?? []).map(async (u) => {
      const [permission, info] = await Promise.all([
        d.rpc("dmcrm_document_access", {
          p_org: s.org_id,
          p_actor: s.user_id,
          p_opportunity: u.opportunity_id,
        }),
        d.storage.from("dmcrm-deal-files").info(u.path),
      ]);
      return canReadDealFile(s.role, u) &&
        permission.data === true &&
        !info.error &&
        info.data.size === u.size
        ? { id: u.id, name: u.name }
        : null;
    }),
  );
  return json({ files: files.filter(Boolean) });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request" }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in to file documents." }, 401);
  if (Number(req.headers.get("content-length")) > 16000)
    return json({ error: "Request too large." }, 413);
  try {
    const body = await req.json(),
      d = db();
    if (body.action === "prepare") {
      const v = prepareDocumentSchema.parse(body);
      if (!canReadDealFile(s.role, v))
        return json(
          { error: "Your role cannot file this document type." },
          403,
        );
      let vehicleSnapshot: Record<string, string | null> | null = null;
      const permission = await d.rpc("dmcrm_document_access", {
        p_org: s.org_id,
        p_actor: s.user_id,
        p_opportunity: v.opportunity_id,
      });
      if (permission.error || permission.data !== true)
        return json(
          {
            error:
              "Assigned salesperson or manager required. Inventory-only files require a manager.",
          },
          403,
        );
      if (v.customer_id) {
        const c = await d
          .from("dmcrm_customers")
          .select("id")
          .eq("org_id", s.org_id)
          .eq("id", v.customer_id)
          .maybeSingle();
        if (c.error || !c.data)
          return json({ error: "Customer not found." }, 400);
      }
      if (v.inventory_id) {
        const i = await d
          .from("dmcrm_inventory")
          .select("id")
          .eq("org_id", s.org_id)
          .eq("id", v.inventory_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (i.error || !i.data)
          return json({ error: "Inventory vehicle not found." }, 400);
      }
      if (v.opportunity_id) {
        const o = await d
          .from("dmcrm_opportunities")
          .select("id,inventory_id,vehicle_details,vehicle_interest")
          .eq("org_id", s.org_id)
          .eq("customer_id", v.customer_id)
          .eq("id", v.opportunity_id)
          .maybeSingle();
        if (
          o.error ||
          !o.data ||
          (v.inventory_id && v.inventory_id !== o.data.inventory_id)
        )
          return json(
            { error: "Choose the vehicle attached to this opportunity." },
            400,
          );
        v.inventory_id = o.data.inventory_id;
        vehicleSnapshot = {
          vin: o.data.vehicle_details?.vin ?? null,
          stock_number: o.data.vehicle_details?.stock_number ?? null,
          label: o.data.vehicle_interest,
        };
      }
      const id = crypto.randomUUID(),
        path = `${s.org_id}/vault/${id}.${v.mime === "application/pdf" ? "pdf" : v.mime === "image/png" ? "png" : "jpg"}`;
      const saved = await d.from("dmcrm_document_uploads").insert({
        ...v,
        id,
        org_id: s.org_id,
        created_by: s.user_id,
        path,
        vehicle_snapshot: vehicleSnapshot,
        name: v.name.replace(/[\x00-\x1f/\\]/g, "_"),
      });
      if (saved.error) throw Error("prepare");
      const signed = await d.storage
        .from("dmcrm-deal-files")
        .createSignedUploadUrl(path, { upsert: false });
      if (signed.error || !signed.data) throw Error("storage");
      return json({ id, url: signed.data.signedUrl });
    }
    if (body.action === "complete") {
      const id = z.uuid().parse(body.id);
      const { data: u, error } = await d
        .from("dmcrm_document_uploads")
        .select("*")
        .eq("org_id", s.org_id)
        .eq("created_by", s.user_id)
        .eq("id", id)
        .maybeSingle();
      if (error || !u) return json({ error: "Upload not found." }, 404);
      if (!canReadDealFile(s.role, u))
        return json({ error: "Access denied." }, 403);
      const allowed = await d.rpc("dmcrm_document_access", {
        p_org: s.org_id,
        p_actor: s.user_id,
        p_opportunity: u.opportunity_id,
      });
      if (allowed.error || allowed.data !== true)
        return json({ error: "Document access denied." }, 403);
      if (u.completed_at) return json({ id });
      if (Date.now() - Date.parse(u.created_at) > 86400000)
        return json(
          { error: "Upload expired. Please select and upload the file again." },
          400,
        );
      const bucket = d.storage.from("dmcrm-deal-files"),
        info = await bucket.info(u.path);
      if (info.error || info.data?.size !== u.size)
        return json(
          {
            error:
              "Upload is incomplete or the file size does not match. Retry the upload.",
          },
          400,
        );
      const download = await bucket.download(u.path);
      if (download.error || !download.data) throw Error("verification");
      const bytes = new Uint8Array(await download.data.arrayBuffer());
      if (bytes.length !== u.size || documentMime(bytes) !== u.mime)
        return json(
          { error: "The file contents must be a valid PDF, JPG or PNG." },
          400,
        );
      const result = await d.rpc("dmcrm_complete_document", {
        p_org: s.org_id,
        p_actor: s.user_id,
        p_id: id,
        p_sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      if (result.error) throw Error("filing");
      return json({ id });
    }
    return json({ error: "Unknown document action." }, 400);
  } catch (e) {
    return json(
      {
        error:
          e instanceof z.ZodError
            ? "Choose a customer or vehicle and a PDF, JPG or PNG up to 25 MB."
            : "Document could not be filed. Please retry.",
      },
      400,
    );
  }
}
