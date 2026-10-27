import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../lib/server";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 403, headers },
    );
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return NextResponse.json(
      { error: "Link unavailable" },
      { status: 404, headers },
    );
  const { data, error } = await db().rpc("dmcrm_public_unsubscribe", {
    p_token: token,
    p_confirm: true,
  });
  return NextResponse.json(
    error || !data
      ? { error: "This link is unavailable. Call (252) 541-0040 for help." }
      : { ok: true },
    { status: error || !data ? 404 : 200, headers },
  );
}
