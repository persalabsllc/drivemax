import { NextResponse } from "next/server";
import { db, session } from "../../../../../lib/server";
import { buildCustomerQuotePdf } from "../../../../../lib/quote-export";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await session();
  if (!s)
    return NextResponse.json(
      { error: "Sign in to access this quote." },
      { status: 401 },
    );
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new NextResponse(null, { status: 404 });
  const { data: q } = await db()
    .from("dmcrm_quotes")
    .select("*")
    .eq("org_id", s.org_id)
    .eq("id", id)
    .maybeSingle();
  if (!q) return new NextResponse(null, { status: 404 });
  const { data: c } = await db()
    .from("dmcrm_customers")
    .select("*")
    .eq("org_id", s.org_id)
    .eq("id", q.customer_id)
    .maybeSingle();
  if (!c) return new NextResponse(null, { status: 404 });
  const bytes = await buildCustomerQuotePdf(q, c);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="drive-max-quote-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
