import { protectionPdfAssets } from "../../../../../lib/protection-pdf-server";
import { z } from "zod";
import { db, session } from "../../../../../lib/server";
import { canDesk } from "../../../../../lib/permissions";
import { buildProtectionPdf } from "../../../../../lib/protection-pdf";
import type { ProtectionContract } from "../../../../../lib/protection";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await session();
  if (!s)
    return Response.json(
      { error: "Sign in again to view this contract." },
      { status: 401 },
    );
  if (!canDesk(s.role))
    return Response.json(
      { error: "Manager access required." },
      { status: 403 },
    );
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Contract unavailable." }, { status: 404 });
  const { data, error } = await db()
    .from("dmcrm_protection_contracts")
    .select("*")
    .eq("org_id", s.org_id)
    .eq("id", id)
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "Unable to load contract. Please try again." },
      { status: 503 },
    );
  if (!data)
    return Response.json({ error: "Contract unavailable." }, { status: 404 });
  try {
    const canceled =
      new URL(request.url).searchParams.get("cancellation") === "1";
    const { logo, fonts } = await protectionPdfAssets();
    const bytes = await buildProtectionPdf(
      data as ProtectionContract,
      logo,
      false,
      canceled,
      fonts,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.contract_number}${canceled ? "-cancellation" : ""}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "This PDF could not be prepared. Contact your manager." },
      { status: 500 },
    );
  }
}
