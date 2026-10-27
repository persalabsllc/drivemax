import { z } from "zod";
import type { Customer, Opportunity, Workspace } from "./model";

export const emailTokens = [
  "first_name",
  "customer_name",
  "vehicle",
  "salesperson",
  "dealership",
  "phone",
  "website",
  "appointment_time", "appointment_type", "appointment_link", "address",
] as const;
export const emailCategories = [
  "New lead",
  "Follow-up",
  "Sold",
  "Anniversary",
  "Birthday",
  "Other",
] as const;
export type EmailTemplate = {
  id: string;
  org_id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  system_key?: string | null;
  revision: number;
};
export type EmailSettings = {
  org_id: string;
  auto_reply_enabled: boolean;
  auto_reply_template_id: string | null;
  auto_reply_signature: string;
  enabled_from: string;
  revision: number;
};
export type EmailSignature = {
  org_id: string;
  user_id: string;
  body: string;
  revision: number;
};
export type EmailConnection = {
  connected: boolean;
  sender: string;
  reason?: string;
};
export const dealershipSignature =
  "Drive Max Used Cars\n6210 Old US Hwy 70 West\nNew Bern, NC 28562\n(252) 541-0040\nhttps://www.drivemaxusedcars.com";
const templateText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].every((m) =>
          emailTokens.includes(m[1].trim() as (typeof emailTokens)[number]),
        ),
      "Use the personalization fields listed below.",
    )
    .refine(
      (value) =>
        !value
          .replace(
            /{{\s*(first_name|customer_name|vehicle|salesperson|dealership|phone|website|appointment_time|appointment_type|appointment_link|address)\s*}}/g,
            "",
          )
          .includes("{{"),
      "Check the personalization field brackets.",
    );
export const emailTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(emailCategories),
  subject: templateText(250).refine(
    (s) => !/[\r\n]/.test(s),
    "Keep the subject on one line.",
  ),
  body: templateText(12000),
});
export const emailCommands = [
  z.object({
    type: z.literal("save_email_template"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    template: emailTemplateSchema,
  }),
  z.object({
    type: z.literal("delete_email_template"),
    id: z.uuid(),
    revision: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("save_email_signature"),
    revision: z.number().int().min(0),
    body: z.string().trim().max(3000),
  }),
  z.object({
    type: z.literal("save_email_settings"),
    revision: z.number().int().min(0),
    enabled: z.boolean(),
    template_id: z.uuid().nullable(),
    signature: z.string().trim().max(3000),
  }),
  z.object({
    type: z.literal("set_email_opt_out"),
    customer_id: z.uuid(),
    opted_out: z.boolean(),
  }),
] as const;

export function personalSignature(ws: Workspace) {
  return (
    ws.email_signature?.body ?? `${ws.member.name}\n${dealershipSignature}`
  );
}
export function appendSignature(body: string, signature: string) {
  return [body.trim(), signature.trim()].filter(Boolean).join("\n\n");
}
export function renderEmailTemplate(
  t: Pick<EmailTemplate, "subject" | "body">,
  ws: Workspace,
  c: Customer,
  o?: Opportunity | null,
) {
  const values: Record<(typeof emailTokens)[number], string> = {
    first_name:
      c.person?.first_name?.trim() || c.name.trim().split(/\s+/)[0] || "there",
    customer_name: c.name || "there",
    vehicle: o?.vehicle_interest || c.vehicle_interest || "your next vehicle",
    salesperson: ws.member.name,
    dealership: ws.org.name,
    phone: "(252) 541-0040",
    website: "https://www.drivemaxusedcars.com",
    appointment_time: "[appointment date and time]",
    appointment_type: "visit",
    appointment_link: "[included automatically in appointment emails]",
    address: "6210 Old US Hwy 70 W, New Bern, NC 28562",
  };
  const render = (value: string) =>
    value.replace(
      /{{\s*([^{}]+?)\s*}}/g,
      (_, key: string) => values[key.trim() as keyof typeof values] ?? "",
    );
  return {
    subject: render(t.subject)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 250),
    body: render(t.body),
  };
}

export const starterEmailTemplates = [
  {
    key: "new-lead",
    name: "First response · new website lead",
    category: "New lead",
    subject: "Thanks for contacting Drive Max!",
    body: "Hi {{first_name}},\n\nThank you for your interest in Drive Max Used Cars! We received your inquiry, and a Drive Max team member will be in touch shortly to help.\n\nIf there is anything else you would like us to know, just reply to this email. We look forward to helping you!",
  },
  {
    key: "day-1",
    name: "Day 1 · how can we help?",
    category: "Follow-up",
    subject: "How can we help with your vehicle search?",
    body: "Hi {{first_name}},\n\nI'm following up on your interest in {{vehicle}}. What questions can I answer for you?\n\nLet me know what matters most in your next vehicle, and I can help you explore the options. You can reply here or call {{phone}}.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "day-2",
    name: "Day 2 · arrange a visit",
    category: "Follow-up",
    subject: "Would you like to stop by Drive Max?",
    body: "Hi {{first_name}},\n\nWould it help to see {{vehicle}} in person? Send me a day and time that works for you, and I'll check availability and help arrange a visit.\n\nThere is no pressure. We're happy to answer questions and help you find the right fit.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "day-3",
    name: "Day 3 · narrow down the options",
    category: "Follow-up",
    subject: "Let's narrow down your options",
    body: "Hi {{first_name}},\n\nAre you still considering {{vehicle}}, or has your search changed? If you share the features, size, or price range you're looking for, I can help point you toward suitable vehicles.\n\nReply whenever it's convenient. I'm happy to help.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "day-4",
    name: "Day 4 · trade and financing questions",
    category: "Follow-up",
    subject: "Any questions about your next steps?",
    body: "Hi {{first_name}},\n\nIf a trade-in or financing is part of your plans, we can explain the next steps and what information is needed. Please don't send Social Security numbers, account numbers, or other sensitive financial details by email.\n\nWould you prefer a quick phone call or a visit? Let me know what works for you.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "day-5",
    name: "Day 5 · shopping check-in",
    category: "Follow-up",
    subject: "How is your vehicle search going?",
    body: "Hi {{first_name}},\n\nI wanted to check in and see how your vehicle search is going. If you're still looking, I'm here to answer questions about {{vehicle}} or help you consider other options.\n\nIf you've already found a vehicle, congratulations! Just let me know so I can update your inquiry.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "day-6",
    name: "Day 6 · keep the door open",
    category: "Follow-up",
    subject: "Here when you're ready",
    body: "Hi {{first_name}},\n\nI know buying a vehicle takes time. If now isn't the right moment, that's completely fine.\n\nWhenever you're ready, you can reply to this email, call {{phone}}, or browse our current inventory at {{website}}. Thank you again for considering Drive Max.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "sold",
    name: "Sold · thank you for your purchase",
    category: "Sold",
    subject: "Thank you for choosing Drive Max!",
    body: "Hi {{first_name}},\n\nThank you for purchasing {{vehicle}} from Drive Max Used Cars! We appreciate your business and the opportunity to help.\n\nIf you have questions about your paperwork or anything we discussed during your purchase, reply here or call {{phone}}. We're glad to help.\n\nEnjoy your vehicle, and thank you again!",
  },
  {
    key: "sold-7",
    name: "7 days after sale · ownership check-in",
    category: "Sold",
    subject: "How is everything going with your vehicle?",
    body: "Hi {{first_name}},\n\nIt's been about a week since your purchase, and I wanted to check in. How is everything going with {{vehicle}}?\n\nIf you have questions about your paperwork or need help finding information from your purchase, please let me know.\n\nThank you again for choosing Drive Max!",
  },
  {
    key: "anniversary-6",
    name: "6-month anniversary",
    category: "Anniversary",
    subject: "Happy six months with your vehicle!",
    body: "Hi {{first_name}},\n\nHappy six-month anniversary of your purchase of {{vehicle}}! We hope you're enjoying it and wanted to thank you again for choosing Drive Max.\n\nIf your vehicle needs have changed or you have a question, we're happy to hear from you.\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "birthday",
    name: "Birthday wishes",
    category: "Birthday",
    subject: "Happy birthday from Drive Max!",
    body: "Hi {{first_name}},\n\nWishing you a happy birthday and a wonderful year ahead! Thank you for being part of the Drive Max community.\n\nEnjoy your day!\n\nIf you would prefer no further follow-up emails, just reply and let us know.",
  },
  {
    key: "test-drive",
    name: "Test drive · confirm a requested time",
    category: "Other",
    subject: "Let's plan your Drive Max test drive",
    body: "Hi {{first_name}},\n\nThank you for your interest in a test drive of {{vehicle}}. What day and time works best for you?\n\nOnce we've checked vehicle and staff availability, we'll confirm the appointment with you. You can reply here or reach us at {{phone}}.",
  },
  {
    key: "sell-car",
    name: "Sell us your car · next steps",
    category: "Other",
    subject: "Thanks for telling us about your vehicle",
    body: "Hi {{first_name}},\n\nThank you for giving Drive Max the opportunity to learn about your vehicle. Our team can review the details with you and arrange a time to see it.\n\nWhat is the best time to reach you? Any offer will depend on our review and inspection of the vehicle.",
  },
] as const;

export function demoEmailTemplates(org: string): EmailTemplate[] {
  return starterEmailTemplates.map((t, i) => ({
    id: `e0140000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    org_id: org,
    name: t.name,
    category: t.category,
    subject: t.subject,
    body: t.body,
    system_key: t.key,
    revision: 0,
  }));
}
