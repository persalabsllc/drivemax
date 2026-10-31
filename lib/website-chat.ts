import { z } from "zod";

export const CHAT_MODEL = "openai/gpt-6.1-terra";
export const CHAT_NOTICE = "website-chat-v1";
export type ChatVehicle = {
  title: string;
  href: string;
  image: string | null;
  price: number;
  total: number;
  miles: number;
  status: string;
};
export type ChatMessage = {
  id: string;
  sender: "visitor" | "assistant" | "staff" | "system";
  body: string;
  staff_name: string | null;
  created_at: string;
  data: { vehicles?: ChatVehicle[]; contact?: boolean; appointments?: boolean };
};
export type ChatSnapshot = {
  id: string;
  state: "ai" | "waiting" | "human" | "closed";
  contact_saved: boolean;
  busy: boolean;
  messages: ChatMessage[];
  appointment: {
    starts_at: string;
    status: string;
    duration_minutes: number;
  } | null;
};
export type ChatConfig = {
  enabled: boolean;
  public_name: string;
  greeting: string;
  photo: string;
  phone: string;
  booking_enabled: boolean;
};
export type ChatSlot = { starts_at: string; label: string };
const contact = z
  .object({
    action: z.literal("contact"),
    name: z.string().trim().min(2).max(100),
    email: z.union([z.literal(""), z.email().max(254)]).default(""),
    phone: z.string().trim().max(30).default(""),
    consent: z.literal(true),
  })
  .refine((v) => !!(v.email || v.phone), "Enter a phone number or email.")
  .refine(
    (v) =>
      !v.phone ||
      (/^\+?[\d ()-.]+$/.test(v.phone) &&
        v.phone.replace(/\D/g, "").length >= 10 &&
        v.phone.replace(/\D/g, "").length <= 15),
    "Check your phone number.",
  );
export const chatActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    page_path: z
      .string()
      .max(250)
      .regex(/^\/(?!\/)[^?#]*$/)
      .default("/"),
  }),
  z.object({
    action: z.literal("message"),
    body: z.string().trim().min(1).max(2000),
    request_id: z.uuid(),
    page_path: z
      .string()
      .max(250)
      .regex(/^\/(?!\/)[^?#]*$/)
      .optional(),
    intent: z
      .enum(["general", "availability", "sell", "protection"])
      .optional(),
  }),
  contact,
  z.object({ action: z.literal("slots") }),
  z.object({ action: z.literal("handoff") }),
  z.object({
    action: z.literal("book"),
    starts_at: z.iso.datetime({ offset: true }),
    confirmed: z.literal(true),
  }),
]);
export const protectionKnowledge = `Drive Max Protection product descriptions (specific issued contract controls coverage, limits, exclusions and deductible):
Deluxe: listed engine, transmission, transfer case and drive axle powertrain components.
Platinum: Deluxe powertrain components plus listed alternator, water pump, thermostat, sensors and engine accessories.
Prepaid maintenance: oil/filter change and tire rotation up to $125 combined per covered visit; visit count and interval are selected in the contract.
Tire and wheel: covered road-hazard damage from potholes, curbs or roadway objects, unrepairable punctures, and covered cracked/damaged rims; covered repairs include parts, labor, mounting and balancing.
Paintless dent repair: eligible dents no larger than a credit card, with intact paint and access for paintless repair.
Appearance protection: 8 years, unlimited mileage; covered interior stains and tears and exterior fading, sun spots, acid rain, bird droppings and sap.
Key replacement: maximum 3 keys over the contract, maximum 2 in any rolling 12-month period, including covered cutting/programming.
Deluxe and Platinum can be quoted with short terms from 6 months and deductibles of $0, $250, $500 or $1,000. A staff member must confirm eligibility and quote a customer price. No public fixed warranty prices are supplied. Never quote internal product costs, claims fund allocation or profits. Never decide eligibility of a specific claim, promise a repair, or access an existing contract without staff verification.`;

// Rates verified against the Gateway catalog for this exact model. Cache discounts
// are deliberately ignored, making the app's estimate conservative.
export function chatUsageCost(
  input: number | undefined,
  output: number | undefined,
) {
  if (input === undefined || output === undefined) return 0.5;
  return Math.ceil((input * 0.000001 + output * 0.000005) * 1e6) / 1e6;
}
export function publicChatSnapshot(
  value: ChatSnapshot & { run_id?: string; intent?: string },
) {
  const { id, state, contact_saved, busy, messages, appointment } = value;
  return { id, state, contact_saved, busy, messages, appointment };
}
