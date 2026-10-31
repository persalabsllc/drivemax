import { z } from "zod";
export type WebsiteChatThread = {
  id: string;
  state: "ai" | "waiting" | "human" | "closed";
  assigned_to: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string;
  intent: string;
  page_path: string;
  appointment_id: string | null;
  unread: boolean;
  updated_at: string;
  preview: string;
};
export type WebsiteChatMessage = {
  id: string;
  sender: "visitor" | "assistant" | "staff" | "system";
  body: string;
  staff_name: string | null;
  created_at: string;
  data: {
    vehicles?: { title: string; href: string; total: number; status: string }[];
  };
};
export type WebsiteChatConversation = {
  id: string;
  state: WebsiteChatThread["state"];
  contact_saved: boolean;
  busy: boolean;
  messages: WebsiteChatMessage[];
  appointment: { starts_at: string; status: string } | null;
};
export type WebsiteChatSettings = {
  enabled: boolean;
  ai_enabled: boolean;
  booking_enabled: boolean;
  public_name: string;
  greeting: string;
  assigned_to: string | null;
  monthly_budget: number;
};
export type WebsiteChatData = {
  threads: WebsiteChatThread[];
  conversation: WebsiteChatConversation | null;
  staff: { id: string; name: string }[];
  settings: WebsiteChatSettings | null;
  usage: {
    estimated_spend: number;
    replies: number;
    unavailable: number;
    pending: number;
  } | null;
};
const id = z.uuid();
export const websiteChatSettingsSchema = z.object({
  enabled: z.boolean(),
  ai_enabled: z.boolean(),
  booking_enabled: z.boolean(),
  public_name: z.string().trim().min(1).max(60),
  greeting: z.string().trim().min(1).max(400),
  assigned_to: id.nullable(),
  monthly_budget: z.coerce.number().min(0).max(500),
});
export const websiteChatCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["read", "take", "release", "close"]), id }),
  z.object({
    action: z.literal("reply"),
    id,
    body: z.string().trim().min(1).max(2000),
    request_id: id,
  }),
  z.object({ action: z.literal("assign"), id, assigned_to: id.nullable() }),
  z.object({
    action: z.literal("settings"),
    settings: websiteChatSettingsSchema,
  }),
]);
