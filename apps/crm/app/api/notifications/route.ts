import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, session } from "../../../lib/server";
import { validPushEndpoint } from "../../../lib/push";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const s = await session();
  if (!s) return json({ error: "Sign in required" }, 401);
  const { data, error } = await db()
    .from("dmcrm_push_config")
    .select("public_key")
    .eq("id", "vapid")
    .maybeSingle();
  const subscriptions = await db()
    .from("dmcrm_push_subscriptions")
    .select("endpoint")
    .eq("org_id", s.org_id)
    .eq("user_id", s.user_id);
  return json({
    publicKey: error ? null : (data?.public_key ?? null),
    endpoints: subscriptions.data?.map((row) => row.endpoint) ?? [],
  });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request" }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in required" }, 401);
  try {
    const raw = await req.text();
    if (raw.length > 4000) throw Error();
    const input = z
      .object({
        endpoint: z.string().max(2500).refine(validPushEndpoint),
        keys: z.object({
          p256dh: z.string().regex(/^[\w-]{80,100}$/),
          auth: z.string().regex(/^[\w-]{20,30}$/),
        }),
      })
      .parse(JSON.parse(raw));
    const d = db();
    const count = await d
      .from("dmcrm_push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", s.org_id)
      .eq("user_id", s.user_id);
    const existing = await d
      .from("dmcrm_push_subscriptions")
      .select("id")
      .eq("org_id", s.org_id)
      .eq("user_id", s.user_id)
      .eq("endpoint", input.endpoint)
      .maybeSingle();
    if ((count.count ?? 0) >= 5 && !existing.data)
      return json(
        {
          error:
            "Five devices are already enabled. Disable an old device first.",
        },
        400,
      );
    const { error } = await d
      .from("dmcrm_push_subscriptions")
      .upsert(
        {
          org_id: s.org_id,
          user_id: s.user_id,
          endpoint: input.endpoint,
          keys: input.keys,
        },
        { onConflict: "endpoint" },
      );
    if (error) throw Error();
    return json({ ok: true });
  } catch {
    return json(
      { error: "Notifications could not be enabled. Try again." },
      400,
    );
  }
}
export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request" }, 403);
  const s = await session();
  if (!s) return json({ error: "Sign in required" }, 401);
  try {
    const raw = await req.text();
    if (raw.length > 3000) throw Error();
    const { endpoint } = z
      .object({ endpoint: z.string().max(2500) })
      .parse(JSON.parse(raw));
    const { error } = await db()
      .from("dmcrm_push_subscriptions")
      .delete()
      .eq("org_id", s.org_id)
      .eq("user_id", s.user_id)
      .eq("endpoint", endpoint);
    if (error) throw Error();
    return json({ ok: true });
  } catch {
    return json({ error: "Could not disable notifications." }, 400);
  }
}
