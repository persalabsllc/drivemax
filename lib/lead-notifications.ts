import "server-only";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { db } from "./backend";
import { notificationTransport } from "./email-config";
import {
  deliverNotification,
  type NotificationJob,
} from "./notification-delivery";
import type { notificationMessage } from "./notification-message";

async function sendNotification(
  message: ReturnType<typeof notificationMessage>,
  key: string,
) {
  if (notificationTransport() === "smtp") {
    const port = Number(process.env.SMTP_PORT || 465);
    if (![465, 587].includes(port))
      throw new Error("Encrypted SMTP is required");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim() || "mail.privateemail.com",
      port,
      secure: port === 465,
      requireTLS: true,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        ...message,
        messageId: `<${key}@drivemaxusedcars.com>`,
      });
      if (!result.accepted.length || result.rejected.length)
        throw new Error("Notification recipient was not accepted");
      return result.messageId;
    } finally {
      transport.close();
    }
  }
  if (notificationTransport() === "resend") {
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
      message,
      { idempotencyKey: key },
    );
    if (result.error || !result.data)
      throw new Error("Notification send failed");
    return result.data.id;
  }
  throw new Error("Notification email is not configured");
}

// One current lead plus one older queued alert can be attempted per invocation.
// A bounded worker fits the function timeout; the daily cron is a quiet-site backstop.
export async function dispatchLeadNotifications(leadId?: string) {
  if (!notificationTransport())
    return { configured: false, sent: 0, pending: 0 };
  let sent = 0;
  let pending = 0;
  for (let index = 0; index < 2; index++) {
    const { data, error } = await db().rpc("claim_lead_notification", {
      requested_lead_id: index === 0 && leadId ? leadId : null,
    });
    if (error) throw new Error("Notification queue is unavailable");
    const job = data?.[0] as NotificationJob | undefined;
    if (!job) continue;
    const delivered = await deliverNotification(job, {
      send: sendNotification,
      now: () => new Date(),
      save: async (patch) => {
        const saved = await db()
          .from("lead_notifications")
          .update(patch)
          .eq("id", job.id)
          .eq("state", "sending")
          .eq("claim_token", job.claim_token)
          .select("id")
          .maybeSingle();
        if (saved.error || !saved.data)
          throw new Error("Notification claim changed");
      },
    });
    if (delivered) sent++;
    else pending++;
  }
  return { configured: true, sent, pending };
}

export async function dispatchLeadNotificationsSafely(leadId?: string) {
  try {
    return await dispatchLeadNotifications(leadId);
  } catch {
    // The persisted outbox survives a failed worker. Never claim the inquiry failed.
    console.error(
      "Dealership email notification remains queued; delivery needs attention.",
    );
    return { configured: !!notificationTransport(), sent: 0, pending: 1 };
  }
}
