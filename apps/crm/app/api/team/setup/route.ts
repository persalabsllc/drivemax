import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { session, db } from "../../../../lib/server";
import { canManage } from "../../../../lib/model";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again." }, 401);
    if (!canManage(s.role))
      return json({ error: "Manager access required." }, 403);
    const raw = await req.text();
    if (raw.length > 1000) return json({ error: "Request too large." }, 413);
    const input = z.object({ staff_id: z.uuid() }).safeParse(JSON.parse(raw));
    if (!input.success) return json({ error: "Choose a team member." }, 400);
    const token = randomBytes(32).toString("hex"),
      hash = createHash("sha256").update(token).digest("hex");
    const { error } = await db().rpc("dmcrm_create_staff_invite", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_staff: input.data.staff_id,
      p_hash: hash,
    });
    if (error)
      return json(
        {
          error:
            "Setup links are available only for active, unlinked team members you manage.",
        },
        403,
      );
    return json({
      url: new URL("/team-setup", req.url).toString() + "#" + token,
      expires_hours: 72,
    });
  } catch {
    return json(
      { error: "Could not create the setup link. Please try again." },
      400,
    );
  }
}
