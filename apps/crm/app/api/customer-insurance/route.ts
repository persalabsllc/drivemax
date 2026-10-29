import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, session } from "../../../lib/server";
import { insuranceSchema } from "../../../lib/people";
import { matchingInsuranceCard } from "../../../lib/insurance-scan";
import { MAX_LICENSE_BYTES } from "../../../lib/license-scan";
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
  const input = z
    .object({ customer_id: z.uuid(), opportunity_id: z.uuid().nullable() })
    .safeParse({
      customer_id: req.nextUrl.searchParams.get("customer_id"),
      opportunity_id: req.nextUrl.searchParams.get("opportunity_id"),
    });
  if (!input.success) return json({ error: "Customer required." }, 400);
  const { customer_id, opportunity_id } = input.data,
    d = db();
  const permission = await d.rpc("dmcrm_insurance_access", {
    p_org: s.org_id,
    p_actor: s.user_id,
    p_customer: customer_id,
    p_opportunity: opportunity_id,
  });
  if (permission.error)
    return json({ error: "Insurance cards are temporarily unavailable." }, 503);
  if (permission.data !== true)
    return json({ error: "Assigned salesperson or manager required." }, 403);
  const customer = await d
    .from("dmcrm_customers")
    .select("insurance")
    .eq("org_id", s.org_id)
    .eq("id", customer_id)
    .is("merged_into", null)
    .maybeSingle();
  if (customer.error || !customer.data)
    return json({ error: "Customer unavailable." }, 404);
  let policy = customer.data.insurance,
    cutoff: string | null = null;
  if (opportunity_id) {
    const opportunity = await d
      .from("dmcrm_opportunities")
      .select("status,sale_snapshot,closed_at,updated_at")
      .eq("org_id", s.org_id)
      .eq("customer_id", customer_id)
      .eq("id", opportunity_id)
      .maybeSingle();
    if (opportunity.error || !opportunity.data)
      return json({ error: "Opportunity unavailable." }, 404);
    if (["sold", "lost"].includes(opportunity.data.status)) {
      policy = opportunity.data.sale_snapshot?.insurance;
      const sale = await d
        .from("dmcrm_sales")
        .select("created_at")
        .eq("org_id", s.org_id)
        .eq("opportunity_id", opportunity_id)
        .eq("status", "sold")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sale.error)
        return json(
          { error: "Insurance cards are temporarily unavailable." },
          503,
        );
      cutoff =
        sale.data?.created_at ??
        opportunity.data.closed_at ??
        opportunity.data.updated_at;
    }
  }
  let query = d
    .from("dmcrm_deal_files")
    .select("id,created_at,insurance_values,opportunity_id")
    .eq("org_id", s.org_id)
    .eq("customer_id", customer_id)
    .eq("insurance_capture", true);
  query = opportunity_id
    ? query.or(`opportunity_id.is.null,opportunity_id.eq.${opportunity_id}`)
    : query.is("opportunity_id", null);
  if (cutoff) query = query.lte("created_at", cutoff);
  // Policy metadata only; image bytes remain behind the authenticated proxy.
  const result = await query
    .order("created_at", { ascending: false })
    .order("id")
    .limit(250);
  if (result.error)
    return json(
      { error: "Insurance card could not be loaded. Please retry." },
      503,
    );
  return json({
    card: matchingInsuranceCard(
      result.data ?? [],
      policy,
      opportunity_id,
      cutoff,
    ),
  });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request." }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in required." }, 401);
  if (Number(req.headers.get("content-length")) > MAX_LICENSE_BYTES + 65536)
    return json({ error: "Insurance photo must be smaller than 3 MB." }, 413);
  try {
    const form = await req.formData(),
      id = z.uuid().parse(form.get("id")),
      customer = z.uuid().parse(form.get("customer_id")),
      opportunity = z.uuid().nullable().parse(form.get("opportunity_id")),
      insurance = insuranceSchema.parse(
        JSON.parse(String(form.get("insurance"))),
      ),
      file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_LICENSE_BYTES)
      throw Error("image");
    const d = db(),
      permission = await d.rpc("dmcrm_insurance_access", {
        p_org: s.org_id,
        p_actor: s.user_id,
        p_customer: customer,
        p_opportunity: opportunity,
      });
    if (permission.error)
      return json(
        { error: "Insurance cards are temporarily unavailable." },
        503,
      );
    if (permission.data !== true)
      return json({ error: "Assigned salesperson or manager required." }, 403);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw Error("image");
    const { PDFDocument } = await import("pdf-lib"),
      image = await (await PDFDocument.create()).embedJpg(bytes);
    if (
      image.width < 200 ||
      image.height < 100 ||
      image.width > 4096 ||
      image.height > 4096
    )
      throw Error("image");
    const hash = createHash("sha256").update(bytes).digest("hex"),
      path = `${s.org_id}/insurance/${id}.jpg`,
      bucket = d.storage.from("dmcrm-deal-files");
    const upload = await bucket.upload(path, bytes, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "0",
    });
    if (upload.error) {
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
    const result = await d.rpc("dmcrm_save_insurance_capture", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_customer: customer,
      p_opportunity: opportunity,
      p_id: id,
      p_size: bytes.length,
      p_sha256: hash,
      p_insurance: insurance,
    });
    if (result.error) throw Error("filing");
    return json({ id: result.data });
  } catch {
    return json(
      {
        error:
          "The insurance card could not be saved. Your policy details are saved; retry the photo upload. If the policy changed or this deal closed, reopen Insurance before attaching a new card.",
      },
      400,
    );
  }
}
