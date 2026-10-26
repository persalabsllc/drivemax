import "server-only";
import { db, backendReady, emailReady } from "./backend";
import { leadEmailFrom, leadReplyDomain } from "./email-config";
import {
  crmEmailPayload,
  deliverCRMEmail,
  EmailSendError,
  type CRMEmailJob,
} from "./crm-email-delivery";

export function crmEmailReady() {
  return (
    process.env.VERCEL_ENV === "production" &&
    backendReady() &&
    emailReady() &&
    !!process.env.CRM_EMAIL_WORKER_SECRET
  );
}
export async function dispatchCRMEmails(requestedId?: string) {
  if (!crmEmailReady()) return { configured: false, sent: 0, pending: 0 };
  let sent = 0,
    pending = 0;
  for (let i = 0; i < 2; i++) {
    const claimed = await db().rpc("dmcrm_email_claim", {
      p_id: i === 0 && requestedId ? requestedId : null,
    });
    if (claimed.error) throw Error("CRM email queue unavailable");
    const job = claimed.data?.[0] as CRMEmailJob | undefined;
    if (!job) continue;
    const ok = await deliverCRMEmail(job, {
      send: async (message, key) => {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(
            crmEmailPayload(message, leadEmailFrom(), leadReplyDomain()),
          ),
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
        });
        if (!response.ok)
          throw new EmailSendError(
            response.status === 429 ||
              response.status >= 500 ||
              response.status === 409,
          );
        const data = await response.json();
        if (typeof data.id !== "string") throw new EmailSendError(true);
        return data.id;
      },
      finish: async (state, provider, error) => {
        const result = await db().rpc("dmcrm_email_finish", {
          p_id: job.message_id,
          p_claim: job.claim_token,
          p_state: state,
          p_provider: provider,
          p_error: error,
        });
        if (result.error || !result.data)
          throw Error("CRM email claim changed");
      },
    });
    if (ok) sent++;
    else pending++;
  }
  return { configured: true, sent, pending };
}
export async function dispatchCRMEmailsSafely(id?: string) {
  try {
    return await dispatchCRMEmails(id);
  } catch {
    console.error("CRM email remains queued; delivery needs attention.");
    return { configured: crmEmailReady(), sent: 0, pending: 1 };
  }
}
