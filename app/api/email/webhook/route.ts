import { Resend, type WebhookEventPayload } from "resend";
import { backendReady, db, emailReady } from "../../../../lib/backend";
import { mailbox, replyLeadId } from "../../../../lib/email-routing";

export async function POST(request: Request) {
  if (!backendReady() || !emailReady())
    return new Response("Not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 100000)
    return new Response("Too large", { status: 413 });
  const resend = new Resend(process.env.RESEND_API_KEY);
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
      const id = replyLeadId(event.data.to, process.env.LEAD_REPLY_DOMAIN!);
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
        replyLeadId(email.data.to, process.env.LEAD_REPLY_DOMAIN!) !== id
      )
        return Response.json({ ignored: true });
      // Plain text only in the CRM. Do not render email HTML or download attachments.
      const body = (
        email.data.text ||
        "This reply has no plain-text body. Open the original email in Resend to view its content."
      ).slice(0, 50000);
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
      const known = await db()
        .from("messages")
        .select("id")
        .eq("provider_id", event.data.email_id)
        .maybeSingle();
      if (known.error) throw known.error;
      // A provider event can arrive before the send response is stored. Let Resend retry.
      if (!known.data)
        return new Response("Send record not ready", { status: 503 });
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
