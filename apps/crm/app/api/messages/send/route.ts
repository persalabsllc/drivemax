import { NextRequest, NextResponse } from "next/server";
import { session, db } from "../../../../lib/server";
import { providerFor } from "../../../../lib/messaging";
import { canManage } from "../../../../lib/model";
export async function POST(req: NextRequest) {
  const json = (error: string, status: number) =>
    NextResponse.json(
      { error },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json("Invalid request origin.", 403);
  try {
    const s = await session();
    if (!s) return json("Sign in again.", 401);
    const raw = await req.text();
    if (raw.length > 500) return json("Request too large.", 413);
    const { id } = JSON.parse(raw);
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
      return json("Choose a saved draft.", 400);
    const { data: m } = await db()
      .from("dmcrm_messages")
      .select("id,channel,status,created_by")
      .eq("org_id", s.org_id)
      .eq("id", id)
      .maybeSingle();
    if (!m || (!canManage(s.role) && m.created_by !== s.user_id))
      return json("Draft unavailable.", 403);
    if (m.status !== "draft")
      return json("This message is not an unsent draft.", 409);
    if (!providerFor(m.channel))
      return json(
        "Messaging is not connected. Your draft has been saved and nothing was sent.",
        409,
      );
    // Do not turn on sending merely because an API key exists. Provider activation also
    // requires an atomic outbox claim and verified delivery/inbound processing.
    return json("Messaging activation is not complete. Nothing was sent.", 409);
  } catch {
    return json("Could not prepare this message.", 400);
  }
}
