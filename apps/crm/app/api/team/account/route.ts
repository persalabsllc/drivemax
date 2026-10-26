import { NextRequest, NextResponse } from "next/server";
import { session, db } from "../../../../lib/server";
import { teamAccountSchema } from "../../../../lib/team";
import {
  manageTeamAccount,
  TeamAccountError,
} from "../../../../lib/team-accounts";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again." }, 401);
    if (!["owner", "manager"].includes(s.role))
      return json({ error: "Manager access required." }, 403);
    const raw = await req.text();
    if (raw.length > 8000) return json({ error: "Request too large." }, 413);
    const input = teamAccountSchema.safeParse(JSON.parse(raw));
    if (!input.success)
      return json(
        { error: input.error.issues[0]?.message || "Check the user details." },
        400,
      );
    return json({
      ok: true,
      ...(await manageTeamAccount(db(), s, input.data)),
    });
  } catch (error) {
    if (error instanceof TeamAccountError)
      return json({ error: error.message }, error.status);
    return json(
      {
        error:
          "The account change could not be completed. Refresh the team list before retrying.",
      },
      503,
    );
  }
}
