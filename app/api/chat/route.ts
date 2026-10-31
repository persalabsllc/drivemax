import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { backendReady, db } from "../../../lib/backend";
import { takeSlot } from "../../../lib/rate-limit";
import {
  CHAT_ASSISTANT_PHOTO,
  chatActionSchema,
  publicChatSnapshot,
  type ChatConfig,
} from "../../../lib/website-chat";
import {
  CHAT_ORG,
  CHAT_COOKIE,
  chatRPC,
  readChatCredential,
  tokenHash,
} from "../../../lib/website-chat-server";
import { answerWebsiteChat } from "../../../lib/website-chat-agent";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  if (!backendReady())
    return json({ config: { enabled: false }, conversation: null });
  try {
    const { data: config, error } = await db().rpc("dmcrm_chat_config", {
      p_org: CHAT_ORG,
    });
    if (error) throw error;
    const jar = await cookies(),
      credential = readChatCredential(jar.get(CHAT_COOKIE)?.value);
    let conversation = null;
    if (credential) {
      try {
        conversation = await chatRPC(credential, "read");
      } catch (e) {
        if ((e as { code?: string }).code === "42501") jar.delete(CHAT_COOKIE);
        else throw e;
      }
    }
    return json({
      config: { ...(config as ChatConfig), photo: CHAT_ASSISTANT_PHOTO },
      conversation,
    });
  } catch {
    return json(
      { error: "Chat is temporarily unavailable. Call 252-541-0040." },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Please use the Drive Max website." }, 403);
  if (!backendReady())
    return json({ error: "Call 252-541-0040 to reach the team." }, 503);
  if (Number(request.headers.get("content-length")) > 6000)
    return json({ error: "Message is too long." }, 413);
  try {
    const raw = await request.text();
    if (raw.length > 6000) return json({ error: "Message is too long." }, 413);
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid message." }, 400);
    }
    const parsed = chatActionSchema.safeParse(input);
    if (!parsed.success)
      return json(
        { error: parsed.error.issues[0]?.message || "Check your details." },
        400,
      );
    const { action, ...data } = parsed.data;
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    const limit = action === "start" ? 15 : action === "contact" ? 10 : 120;
    if (!(await takeSlot(ip, "website-chat-" + action, limit)))
      return json(
        { error: "Please wait before trying again, or call 252-541-0040." },
        429,
      );
    const jar = await cookies();
    let credential = readChatCredential(jar.get(CHAT_COOKIE)?.value);
    if (action === "start") {
      if (credential) {
        try {
          const current = await chatRPC(credential, "read");
          if (current.state !== "closed")
            return json({ conversation: current });
        } catch (e) {
          if ((e as { code?: string }).code !== "42501") throw e;
        }
      }
      const token = randomBytes(32).toString("hex");
      credential = { id: randomUUID(), hash: tokenHash(token) };
      let vehicle_id: string | undefined;
      const path = "page_path" in data ? data.page_path || "/" : "/";
      const slug = path.match(/^\/inventory\/([^/]+)\/?$/)?.[1];
      if (slug) {
        const { data: vehicle } = await db()
          .from("vehicles")
          .select("id")
          .eq("slug", decodeURIComponent(slug))
          .in("status", ["available", "pending", "sold"])
          .maybeSingle();
        vehicle_id = vehicle?.id;
      }
      const conversation = await chatRPC(credential, "start", {
        page_path: path,
        vehicle_id,
      });
      jar.set(CHAT_COOKIE, credential.id + "." + token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return json({ conversation });
    }
    if (!credential)
      return json(
        { error: "Start a new chat to continue.", expired: true },
        401,
      );
    if (!(await takeSlot(credential.id, "website-chat-session", 180)))
      return json(
        { error: "Please wait before trying again, or call the dealership." },
        429,
      );
    let context: Record<string, unknown> = {};
    if (action === "message" && "page_path" in data && data.page_path) {
      const slug = data.page_path.match(/^\/inventory\/([^/]+)\/?$/)?.[1];
      if (slug) {
        const { data: vehicle, error } = await db()
          .from("vehicles")
          .select("id")
          .eq("slug", decodeURIComponent(slug))
          .in("status", ["available", "pending", "sold"])
          .maybeSingle();
        if (error) throw error;
        context = { vehicle_id: vehicle?.id || null };
      } else context = { vehicle_id: null };
    }
    const result = await chatRPC(credential, action, { ...data, ...context });
    if (action === "slots") return json(result);
    if (action === "message" && result.run_id) {
      const saved = credential;
      after(() => answerWebsiteChat(saved, result.run_id, result));
    }
    return json({ conversation: publicChatSnapshot(result) });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "42501")
      return json(
        {
          error: "Your chat session expired. Start a new conversation.",
          expired: true,
        },
        401,
      );
    if (err.code === "P0001") return json({ error: err.message }, 409);
    return json(
      {
        error: "We could not save that. Please try again or call 252-541-0040.",
      },
      503,
    );
  }
}
