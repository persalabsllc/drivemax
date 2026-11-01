import { z } from "zod";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
  );
export const activityQuerySchema = z
  .object({
    from: day,
    to: day,
    session: z.uuid().optional(),
    customer: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    source: z
      .enum([
        "",
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
      .default(""),
    vehicle: z.uuid().optional(),
  })
  .refine((v) => {
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
    return days >= 0 && days <= 180;
  }, "Choose a date range of up to 180 days.");
export type WebVisit = {
  id: string;
  visitor_id: string;
  started_at: string;
  last_at: string;
  source: string;
  device: string;
  is_returning: boolean;
  views: number;
  active_seconds: number;
  entry: string | null;
  exit: string | null;
  lead: boolean;
  path: string[] | null;
  customers:
    { id: string; name: string; opportunity_id: string | null }[] | null;
};
export type WebVehicle = {
  id: string;
  slug: string;
  title: string;
  stock_number: string;
  views: number;
  shoppers: number;
  return_visits: number;
  photo_views: number;
  active_seconds: number;
  lead_visits: number;
};
export type WebActivity = {
  summary: null | {
    visitors: number;
    visits: number;
    views: number;
    returning_visits: number;
    active_seconds: number;
    lead_visits: number;
    leads: number;
    chats: number;
    appointments: number;
    sales: number;
    form_starts: number;
    form_submissions: number;
    call_clicks: number;
  };
  sessions: WebVisit[];
  total: number;
  vehicles: WebVehicle[];
  sources: {
    source: string;
    visits: number;
    visitors: number;
    leads: number;
  }[];
  daily: { day: string; visits: number }[];
};
export type WebJourney = {
  events: {
    id: string;
    kind: string;
    path: string;
    seconds: number;
    created_at: string;
  }[];
  event_count: number;
  page_time: { path: string; seconds: number }[];
};
export const activityLabels: Record<string, string> = {
  page_view: "Viewed page",
  photo_view: "Viewed vehicle photo",
  call_click: "Clicked phone number",
  email_click: "Clicked email",
  form_start: "Started inquiry",
  chat_open: "Opened chat",
};
export const activityPage = (path: string) =>
  path === "/"
    ? "Home"
    : path.startsWith("/inventory/")
      ? path.substring(11).split("-").slice(0, -1).join(" ")
      : path.replace(/^\//, "").replaceAll("-", " ");
export const activeTime = (seconds: number) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
export function activityRange(days = 30, now = new Date()) {
  const to = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const from = new Date(Date.parse(to + "T12:00:00Z") - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}
