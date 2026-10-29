import { NextRequest, NextResponse } from "next/server";
import { db, session } from "../../../lib/server";
import { matchInputSchema } from "../../../lib/customer-matches";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request." }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in required." }, 401);
  const raw = await req.text();
  if (raw.length > 3000) return json({ error: "Request too large." }, 413);
  try {
    const input = matchInputSchema.parse(JSON.parse(raw));
    const { data, error } = await db().rpc("dmcrm_customer_matches", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_input: input,
    });
    if (error)
      return json(
        { error: "Customer matches could not be checked. Please retry." },
        503,
      );
    return json({ matches: data ?? [] });
  } catch {
    return json({ error: "Check the contact details." }, 400);
  }
}
