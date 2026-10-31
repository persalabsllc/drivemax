import { NextResponse } from "next/server";
import { session, db } from "../../../lib/server";
import { websiteChatCommandSchema } from "../../../lib/website-chat";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to open website chat." }, 401);
    const { data, error } = await db().rpc("dmcrm_chat_staff", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_action: "list",
      p_data: {},
    });
    if (error) throw error;
    return json(data);
  } catch {
    return json(
      { error: "Website chat could not be loaded. Please try again." },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  if (Number(request.headers.get("content-length")) > 8000)
    return json({ error: "Request too large." }, 413);
  try {
    const s = await session();
    if (!s) return json({ error: "Your session ended. Sign in again." }, 401);
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "Request too large." }, 413);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const parsed = websiteChatCommandSchema.safeParse(value);
    if (!parsed.success)
      return json(
        { error: parsed.error.issues[0]?.message || "Check your details." },
        400,
      );
    const { action, ...details } = parsed.data;
    const { data, error } = await db().rpc("dmcrm_chat_staff", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_action: action,
      p_data: "settings" in details ? details.settings : details,
    });
    if (error) {
      if (error.code === "42501")
        return json(
          { error: "You do not have access to this conversation or setting." },
          403,
        );
      if (error.code === "P0001") return json({ error: error.message }, 409);
      throw error;
    }
    return json(data);
  } catch {
    return json(
      { error: "That change could not be saved. Please try again." },
      503,
    );
  }
}
