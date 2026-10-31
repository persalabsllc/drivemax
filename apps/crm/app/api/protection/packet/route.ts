import { z } from "zod";
import { db, session } from "../../../../lib/server";
import { canManage } from "../../../../lib/model";
import { protectionPdfAssets } from "../../../../lib/protection-pdf-server";
import { buildProtectionPacketPdf } from "../../../../lib/protection-pdf";
import type { ProtectionContract } from "../../../../lib/protection";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const s = await session();
  if (!s)
    return Response.json(
      { error: "Sign in again to view these contracts." },
      { status: 401 },
    );
  if (!canManage(s.role))
    return Response.json(
      { error: "Manager access required." },
      { status: 403 },
    );
  const parsed = z
    .object({
      ids: z
        .array(z.uuid())
        .min(1)
        .max(30)
        .refine((a) => new Set(a).size === a.length),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Select up to 30 different contracts." },
      { status: 400 },
    );
  const { data, error } = await db()
    .from("dmcrm_protection_contracts")
    .select("*")
    .eq("org_id", s.org_id)
    .in("id", parsed.data.ids);
  if (error)
    return Response.json(
      { error: "Unable to load contracts. Please try again." },
      { status: 503 },
    );
  if (!data || data.length !== parsed.data.ids.length)
    return Response.json({ error: "Contract unavailable." }, { status: 404 });
  const contracts = parsed.data.ids.map(
    (id) => data.find((c) => c.id === id) as ProtectionContract,
  );
  if (
    contracts.some(
      (c) =>
        c.customer_id !== contracts[0].customer_id ||
        c.vin !== contracts[0].vin,
    )
  )
    return Response.json(
      { error: "Select contracts for the same customer and vehicle." },
      { status: 400 },
    );
  try {
    const { logo, fonts } = await protectionPdfAssets();
    const bytes = await buildProtectionPacketPdf(contracts, logo, false, fonts);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'inline; filename="Drive-Max-Protection-Packet.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "This packet could not be prepared. Contact your manager." },
      { status: 500 },
    );
  }
}
