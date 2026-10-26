export type CRMEmailJob = {
  message_id: string;
  claim_token: string;
  recipient: string;
  subject: string;
  body: string;
  sender_name: string;
  reply_token: string;
  provider_id: string | null;
  attachments: { filename: string; content: string; content_type: string }[];
};
export class EmailSendError extends Error {
  constructor(public retryable: boolean) {
    super("Email delivery was not confirmed");
  }
}
export function crmEmailPayload(
  job: CRMEmailJob,
  from: string,
  replyDomain: string,
) {
  // Names and body are plain text; there is no untrusted HTML or remote attachment fetch.
  const address = from.match(/<([^<>]+)>/)?.[1] || from;
  const name = job.sender_name
    .replace(/[\r\n<>"\\]/g, "")
    .trim()
    .slice(0, 100);
  return {
    from: `${name === "Drive Max team" ? "Drive Max Used Cars" : `${name} at Drive Max`} <${address}>`,
    to: job.recipient,
    subject: job.subject,
    text: job.body,
    reply_to: `crm+${job.reply_token}@${replyDomain}`,
    ...(job.attachments.length ? { attachments: job.attachments } : {}),
    tags: [{ name: "source", value: "drive-max-crm" }],
  };
}
export async function deliverCRMEmail(
  job: CRMEmailJob,
  deps: {
    send: (job: CRMEmailJob, key: string) => Promise<string>;
    finish: (
      state: "sent" | "retry" | "failed",
      provider: string | null,
      error: string | null,
    ) => Promise<void>;
  },
) {
  let providerId = job.provider_id;
  try {
    providerId ||= await deps.send(job, `crm-email-${job.message_id}`);
    await deps.finish("sent", providerId, null);
    return true;
  } catch (error) {
    const retry =
      providerId !== null ||
      !(error instanceof EmailSendError) ||
      error.retryable;
    // If recording success failed, retain the provider ID. If the database is still
    // unavailable the claim expires and the same immutable payload/key is retried.
    await deps.finish(
      retry ? "retry" : "failed",
      providerId,
      providerId
        ? "Email accepted; waiting to confirm its saved status."
        : retry
          ? "Temporary delivery problem; queued for retry."
          : "Email provider rejected this message. Review recipient and connection settings.",
    );
    return false;
  }
}
