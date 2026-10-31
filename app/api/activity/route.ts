import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendReady, db, staffSession } from "../../../lib/backend";
import { takeSlot } from "../../../lib/rate-limit";
import { CHAT_ORG, readChatCredential } from "../../../lib/website-chat-server";
import {
  ACTIVITY_CHOICE,
  ACTIVITY_COOKIE,
  activityRequestSchema,
  excludedAgent,
  privacySignal,
} from "../../../lib/website-activity";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 90 * 86400,
};
export async function GET(request: Request) {
  const choice = (await cookies()).get(ACTIVITY_CHOICE)?.value;
  return json({
    choice: privacySignal(request.headers)
      ? "deny"
      : choice === "allow" || choice === "deny"
        ? choice
        : null,
    privacy_signal: privacySignal(request.headers),
  });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Invalid origin" }, 403);
  if (Number(request.headers.get("content-length")) > 8000)
    return json({ error: "Too large" }, 413);
  try {
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "Too large" }, 413);
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const parsed = activityRequestSchema.safeParse(input);
    if (!parsed.success) return json({ error: "Invalid activity" }, 400);
    const jar = await cookies();
    if (parsed.data.action === "choice") {
      const allow = parsed.data.allow && !privacySignal(request.headers);
      jar.set(ACTIVITY_CHOICE, allow ? "allow" : "deny", options);
      if (!allow) jar.delete(ACTIVITY_COOKIE);
      return json({ choice: allow ? "allow" : "deny" });
    }
    if (
      privacySignal(request.headers) ||
      jar.get(ACTIVITY_CHOICE)?.value !== "allow"
    )
      return json({ recorded: false });
    if (
      process.env.VERCEL_ENV === "preview" ||
      excludedAgent(request.headers.get("user-agent") || "")
    )
      return json({ recorded: false });
    if (!backendReady()) return json({ recorded: false });
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    if (!(await takeSlot(ip, "website-activity", 240)))
      return json({ recorded: false }, 429);
    // Signed-in website staff previews are excluded from shopping statistics.
    if (await staffSession()) return json({ recorded: false });
    let rawCredential = jar.get(ACTIVITY_COOKIE)?.value;
    let credential = readChatCredential(rawCredential);
    if (!credential) {
      rawCredential = randomUUID() + "." + randomBytes(32).toString("hex");
      credential = readChatCredential(rawCredential)!;
    }
    const agent = request.headers.get("user-agent") || "";
    const { error } = await db().rpc("dmcrm_web_record", {
      p_org: CHAT_ORG,
      p_visitor: credential.id,
      p_token: credential.hash,
      p_events: parsed.data.events,
      p_source: parsed.data.source,
      p_device: /ipad|tablet/i.test(agent)
        ? "Tablet"
        : /mobi|iphone|android/i.test(agent)
          ? "Mobile"
          : "Desktop",
    });
    if (error) {
      if (error.code === "42501") jar.delete(ACTIVITY_COOKIE);
      console.warn("Website activity unavailable", error.code);
      return json({ recorded: false }, 503);
    }
    jar.set(ACTIVITY_COOKIE, rawCredential!, options);
    return json({ recorded: true });
  } catch {
    return json({ recorded: false }, 503);
  }
}
