import { NextResponse } from "next/server";
import { attention, session } from "../../../lib/server";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to view alerts." }, 401);
    return json(await attention(s));
  } catch {
    return json({ error: "Alerts could not refresh. Try again." }, 503);
  }
}
