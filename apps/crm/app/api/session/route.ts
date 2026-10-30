import { NextRequest, NextResponse } from "next/server";
import { auth, ready, session } from "../../../lib/server";
import {
  clearSessionCookies,
  readIdleState,
  writeIdleState,
} from "../../../lib/idle-server";
import { activityTime, IDLE_TIMEOUT_MS } from "../../../lib/idle-policy";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const s = await session(),
      idle = await readIdleState();
    if (!s || !idle) return json({ error: "Sign in again." }, 401);
    return json({
      id: idle.id,
      expiresAt: idle.lastActiveAt + IDLE_TIMEOUT_MS,
      serverNow: Date.now(),
    });
  } catch {
    return json({ error: "Session could not be checked." }, 503);
  }
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const raw = await req.text();
    if (raw.length > 1000) return json({ error: "Request too large." }, 413);
    const input = JSON.parse(raw);
    const idle = await readIdleState();
    // Stale tabs cannot renew or sign out a newer login in this browser.
    if (idle && input.id !== idle.id)
      return json({ error: "Session changed." }, 409);
    if (input.action === "logout") {
      try {
        if (ready()) await (await auth()).auth.signOut({ scope: "local" });
      } catch {
        /* Clear local credentials even if the provider is unavailable. */
      } finally {
        await clearSessionCookies();
      }
      return json({ ok: true });
    }
    if (input.action !== "activity")
      return json({ error: "Invalid action." }, 400);
    if (!idle || !(await session()))
      return json({ error: "Sign in again." }, 401);
    const lastActiveAt = activityTime(
      idle.lastActiveAt,
      input.idleForMs,
      Date.now(),
    );
    if (lastActiveAt === null) return json({ error: "Invalid activity." }, 400);
    await writeIdleState({ ...idle, lastActiveAt });
    return json({
      id: idle.id,
      expiresAt: lastActiveAt + IDLE_TIMEOUT_MS,
      serverNow: Date.now(),
    });
  } catch {
    return json({ error: "Session could not be updated." }, 503);
  }
}
