import { z } from "zod";
export const ACTIVITY_CHOICE = "dm_activity_choice";
export const ACTIVITY_COOKIE = "dm_activity_browser";
export const activityKinds = [
  "page_view",
  "engagement",
  "photo_view",
  "call_click",
  "email_click",
  "form_start",
  "chat_open",
] as const;
export type ActivityKind = (typeof activityKinds)[number];
export const activityEventSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(activityKinds),
    path: z
      .string()
      .max(250)
      .regex(/^\/(?!\/)[a-z0-9/-]*$/),
    seconds: z.number().int().min(0).max(30).optional(),
  })
  .strict();
export const activityRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choice"), allow: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("events"),
      events: z.array(activityEventSchema).min(1).max(25),
      source: z
        .enum([
          "Google",
          "Facebook",
          "Instagram",
          "Bing",
          "Other search",
          "Other social",
          "Referral",
          "Email",
          "Direct / unknown",
        ])
        .default("Direct / unknown"),
    })
    .strict(),
]);
export function activityPath(path: string) {
  const safe = path.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return /^\/(?:inventory(?:\/[a-z0-9-]+)?|apply|contact|sell-your-car|payments|about(?:\/staff|\/employment)?|reviews|privacy-policy|areas-we-serve|site-map)?$/.test(
    safe,
  )
    ? safe
    : null;
}
export function activitySource(referrer: string, location: string) {
  let ref: URL | null = null,
    current: URL;
  try {
    current = new URL(location);
    ref = referrer ? new URL(referrer) : null;
  } catch {
    return "Direct / unknown";
  }
  const campaign = (current.searchParams.get("utm_source") || "").toLowerCase();
  const host = ref?.hostname.toLowerCase() || "";
  if (
    ["facebook", "fb", "meta"].includes(campaign) ||
    /(^|\.)facebook\.com$/.test(host) ||
    host === "l.facebook.com"
  )
    return "Facebook";
  if (
    ["instagram", "ig"].includes(campaign) ||
    /(^|\.)instagram\.com$/.test(host)
  )
    return "Instagram";
  if (campaign === "google" || /(^|\.)google\.[a-z.]+$/.test(host))
    return "Google";
  if (campaign === "bing" || /(^|\.)bing\.com$/.test(host)) return "Bing";
  if (["email", "newsletter"].includes(campaign)) return "Email";
  if (/(^|\.)(duckduckgo\.com|yahoo\.com)$/.test(host)) return "Other search";
  if (
    /(^|\.)(t\.co|tiktok\.com|youtube\.com|reddit\.com|pinterest\.com)$/.test(
      host,
    )
  )
    return "Other social";
  if (
    ref &&
    ref.hostname !== current.hostname &&
    !ref.hostname.endsWith("drivemaxusedcars.com")
  )
    return "Referral";
  return "Direct / unknown";
}
export function privacySignal(headers: Pick<Headers, "get">) {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}
export function excludedAgent(agent: string) {
  return /bot\b|crawler|spider|headless|lighthouse|googleother|facebookexternalhit|preview|monitoring/i.test(
    agent,
  );
}
