import { after } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import { backendReady, db, emailReady } from "../../../../lib/backend";
import {
  mailbox,
  replyLeadId,
  replyCRMToken,
} from "../../../../lib/email-routing";
import { leadReplyDomain } from "../../../../lib/email-config";
import { dispatchLeadNotificationsSafely } from "../../../../lib/lead-notifications";
import { receivedEmailText } from "../../../../lib/received-email-text";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!backendReady() || !emailReady())
    return new Response("Not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 100000)
    return new Response("Too large", { status: 413 });
  const resend = new Resend(process.env.RESEND_RECEIVING_API_KEY);
  let event: WebhookEventPayload;
  try {
    const payload = await request.text();
    if (payload.length > 100000)
      return new Response("Too large", { status: 413 });
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") || "",
        timestamp: request.headers.get("svix-timestamp") || "",
        signature: request.headers.get("svix-signature") || "",
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    });
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    if (event.type === "email.received") {
      const token = replyCRMToken(event.data.to, leadReplyDomain());
      if (token) {
        const email = await resend.emails.receiving.get(event.data.email_id);
        if (email.error || !email.data)
          throw Error("Could not retrieve received email");
        if (
          replyCRMToken(email.data.to, leadReplyDomain()) !== token ||
          mailbox(email.data.from) !== mailbox(event.data.from)
        )
          return Response.json({ ignored: true });
        const saved = await db().rpc("dmcrm_email_receive", {
          p_token: token,
          p_provider: event.data.email_id,
          p_from: mailbox(email.data.from),
          p_subject: email.data.subject,
          p_body: receivedEmailText(email.data),
          p_received: event.created_at,
        });
        if (saved.error) throw Error("CRM reply could not be saved");
        return Response.json(saved.data ? { ok: true } : { ignored: true });
      }
      const id = replyLeadId(event.data.to, leadReplyDomain());
      if (!id) return Response.json({ ignored: true });
      const { data: lead, error } = await db()
        .from("leads")
        .select("id,email")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!lead || mailbox(event.data.from) !== lead.email.toLowerCase())
        return Response.json({ ignored: true });
      const email = await resend.emails.receiving.get(event.data.email_id);
      if (email.error || !email.data)
        throw new Error("Could not retrieve received email.");
      if (
        mailbox(email.data.from) !== lead.email.toLowerCase() ||
        replyLeadId(email.data.to, leadReplyDomain()) !== id
      )
        return Response.json({ ignored: true });
      const body = receivedEmailText(email.data);
      const saved = await db()
        .from("messages")
        .upsert(
          {
            lead_id: id,
            direction: "inbound",
            body,
            subject: email.data.subject.slice(0, 500),
            state: "received",
            provider_id: event.data.email_id,
            created_at: event.created_at,
          },
          { onConflict: "provider_id", ignoreDuplicates: true },
        );
      if (saved.error) throw saved.error;
      const updated = await db()
        .from("leads")
        .update({ updated_at: event.created_at })
        .eq("id", id)
        .lt("updated_at", event.created_at);
      if (updated.error) throw updated.error;
      after(() => dispatchLeadNotificationsSafely(id));
      return Response.json({ ok: true });
    }
    const states: Record<string, string> = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained",
      "email.suppressed": "suppressed",
      "email.failed": "failed",
    };
    const state = states[event.type];
    if (state && "email_id" in event.data) {
      // Persist the event even when Resend beats the send-response bookkeeping.
      const crm = await db().rpc("dmcrm_email_delivery", {
        p_provider: event.data.email_id,
        p_state: state,
      });
      if (crm.error) throw Error("CRM delivery event could not be saved");
      const known = await db()
        .from("messages")
        .select("id")
        .eq("provider_id", event.data.email_id)
        .maybeSingle();
      if (known.error) throw known.error;
      // The event is durable; database triggers reconcile it if the send response arrives later.
      if (!known.data) {
        const notification = await db()
          .from("lead_notifications")
          .select("id")
          .eq("provider_id", event.data.email_id)
          .maybeSingle();
        if (notification.error) throw notification.error;
        if (!notification.data) return Response.json({ ok: true });
        if (state !== "delivered") {
          const failed = await db()
            .from("lead_notifications")
            .update({ last_error: `Provider reported ${state}` })
            .eq("id", notification.data.id);
          if (failed.error) throw failed.error;
        }
        return Response.json({ ok: true });
      }
      const eligible =
        state === "delivered"
          ? ["sent", "pending", "failed"]
          : ["pending", "sent", "delivered", "failed"];
      const saved = await db()
        .from("messages")
        .update({ state })
        .eq("provider_id", event.data.email_id)
        .eq("direction", "outbound")
        .in("state", eligible);
      if (saved.error) throw saved.error;
    }
    return Response.json({ ok: true });
  } catch {
    return new Response("Processing failed; retry later", { status: 503 });
  }
}
