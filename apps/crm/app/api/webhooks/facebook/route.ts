import { after } from "next/server";
import { db } from "../../../../lib/server";
import { facebookEvents } from "../../../../lib/facebook";
import { equalSecret, limitedBody, validFacebookSignature } from "../../../../lib/webhook-security";
import { dispatchPush } from "../../../../lib/push";
import { refreshFacebookName } from "../../../../lib/facebook-profile";

export const runtime = "nodejs";
export const maxDuration = 60;
const org = "d5a1c100-0000-4000-8000-000000000001";
const reply = (text: string, status: number) => new Response(text, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  if (process.env.VERCEL_ENV !== "production" || !process.env.FACEBOOK_PAGE_ID ||
      !process.env.FACEBOOK_APP_SECRET || !process.env.FACEBOOK_VERIFY_TOKEN) return reply("Not configured", 503);
  const challenge = query.get("hub.challenge") || "";
  if (query.get("hub.mode") !== "subscribe" || !challenge || challenge.length > 2000 ||
      !equalSecret(query.get("hub.verify_token") || "", process.env.FACEBOOK_VERIFY_TOKEN)) return reply("Forbidden", 403);
  return reply(challenge, 200);
}

export async function POST(req: Request) {
  const pageId = process.env.FACEBOOK_PAGE_ID, secret = process.env.FACEBOOK_APP_SECRET;
  if (process.env.VERCEL_ENV !== "production" || !pageId || !secret) return reply("Not configured", 503);
  try {
    const raw = await limitedBody(req);
    if (!validFacebookSignature(raw, req.headers.get("x-hub-signature-256") || "", secret)) return reply("Forbidden", 403);
    let payload: unknown;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { return reply("Invalid JSON", 400); }
    const events = facebookEvents(payload, pageId);
    // Acknowledge only after every message commits. Meta retries a non-2xx;
    // Page/message uniqueness makes retrying a partially imported batch safe.
    for (const event of events) {
      const { error } = await db().rpc("dmcrm_receive_facebook", { p_org: org, p_page: pageId, p_event: event });
      if (error) return reply("Intake temporarily unavailable", 503);
    }
    if (events.length) after(async () => {
      await Promise.all([...new Set(events.map(e=>e.sender_id))].slice(0,20).map(sender=>refreshFacebookName(org,pageId,sender)));
      await dispatchPush();
    });
    return reply("EVENT_RECEIVED", 200);
  } catch (error) {
    return reply(error instanceof Error && error.message === "too_large" ? "Request too large" : "Intake temporarily unavailable",
      error instanceof Error && error.message === "too_large" ? 413 : 503);
  }
}
