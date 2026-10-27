import { z } from "zod";

export const workflowEvents = {
  new_lead: "New opportunity",
  unsold_visit: "Visit ended without a sale",
  sold: "Deal sold",
  appointment_created: "Appointment scheduled",
  appointment_rescheduled: "Appointment rescheduled",
  appointment_canceled: "Appointment canceled",
  no_show: "Appointment marked missed",
  reminder_day: "Before appointment · day before",
  reminder_hour: "Before appointment · same day",
  birthday: "Customer birthday",
  anniversary: "Purchase anniversary",
} as const;
export type WorkflowEvent = keyof typeof workflowEvents;
export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    event: z.enum(
      Object.keys(workflowEvents) as [WorkflowEvent, ...WorkflowEvent[]],
    ),
    enabled: z.boolean(),
    channel: z.enum(["email", "task"]),
    template_id: z.uuid().nullable(),
    delay_minutes: z.number().int().min(0).max(527040),
    task_title: z.string().trim().max(250),
    business_hours: z.boolean(),
    stop_on_reply: z.boolean(),
  })
  .refine(
    (r) => (r.channel === "email" ? !!r.template_id : !!r.task_title),
    "Choose a template or enter a task title.",
  );
export type WorkflowRule = z.infer<typeof ruleSchema> & {
  id: string;
  org_id: string;
  revision: number;
  enabled_from: string;
};
export type WorkflowJob = {
  id: string;
  org_id: string;
  rule_id: string;
  customer_id: string;
  opportunity_id: string | null;
  appointment_id: string | null;
  event: string;
  run_at: string;
  state: "scheduled" | "queued" | "completed" | "skipped" | "canceled";
  reason: string;
  message_id: string | null;
  task_id: string | null;
  created_at: string;
};
export type WorkflowPause = {
  org_id: string;
  customer_id: string;
  paused: boolean;
};
export type WorkflowHealth = {
  last_run_at: string | null;
  scheduled: number;
  failed: number;
};
export const workflowCommands = [
  z.object({
    type: z.literal("save_workflow_rule"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    rule: ruleSchema,
  }),
  z.object({
    type: z.literal("delete_workflow_rule"),
    id: z.uuid(),
    revision: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("pause_customer_workflows"),
    customer_id: z.uuid(),
    paused: z.boolean(),
  }),
  z.object({ type: z.literal("cancel_workflow_job"), id: z.uuid() }),
] as const;
export const appointmentEmailTemplates = [
  {
    key: "appt-created",
    name: "Appointment · confirmation",
    subject: "Your Drive Max appointment",
    body: "Hi {{first_name}},\n\nYou're scheduled for {{appointment_type}} at Drive Max on {{appointment_time}} with {{salesperson}}.\n\nVisit us at {{address}}.\n\nConfirm your visit, request a different time, or add it to your calendar here:\n{{appointment_link}}\n\nWe look forward to seeing you!",
  },
  {
    key: "appt-rescheduled",
    name: "Appointment · new time",
    subject: "Your Drive Max appointment has been rescheduled",
    body: "Hi {{first_name}},\n\nYour appointment has been moved to {{appointment_time}} with {{salesperson}}.\n\nVisit us at {{address}}. Please use this updated link to confirm or add the new time to your calendar:\n{{appointment_link}}\n\nReply here if you need anything before your visit.",
  },
  {
    key: "appt-reminder",
    name: "Appointment · reminder",
    subject: "A reminder about your Drive Max visit",
    body: "Hi {{first_name}},\n\nWe're looking forward to your {{appointment_type}} appointment on {{appointment_time}} with {{salesperson}}.\n\nOur address is {{address}}.\n\nConfirm, request another time, or add this appointment to your calendar:\n{{appointment_link}}\n\nQuestions? Reply here or call {{phone}}.",
  },
  {
    key: "appt-missed",
    name: "Appointment · missed visit",
    subject: "Would another time work better?",
    body: "Hi {{first_name}},\n\nWe missed you at your Drive Max appointment. No worries—plans change!\n\nIf you're still interested, reply with a day and time that works better, or request another visit here:\n{{appointment_link}}\n\nWe're happy to help. You can also reach us at {{phone}}.",
  },
  {
    key: "appt-canceled",
    name: "Appointment · cancellation",
    subject: "Your Drive Max appointment was canceled",
    body: "Hi {{first_name}},\n\nYour appointment for {{appointment_time}} has been canceled.\n\nIf you'd like to arrange another visit, reply to this email or call {{phone}}. We're here whenever you're ready.",
  },
  {
    key: "purchase-anniversary",
    name: "Purchase anniversary · thank you",
    subject: "Happy vehicle anniversary!",
    body: "Hi {{first_name}},\n\nHappy anniversary of your purchase of {{vehicle}}! Thank you again for choosing Drive Max.\n\nIf your vehicle needs have changed or you have a question, just reply. We're happy to help.",
  },
] as const;
