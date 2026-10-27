import { NextResponse, after } from "next/server";
import { attention, session } from "../../../lib/server";
import { dispatchEmail } from "../../../lib/messaging";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to view alerts." }, 401);
    const feed = await attention(s);
    if (feed.emailQueue?.pending)
      after(async () => {
        await dispatchEmail(s.org_id);
      });
    return json(feed);
  } catch {
    return json({ error: "Alerts could not refresh. Try again." }, 503);
  }
}
