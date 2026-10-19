import {
  notificationMessage,
  type NotificationPayload,
} from "./notification-message";

export type NotificationJob = {
  id: string;
  claim_token: string;
  attempts: number;
  provider_id: string | null;
  payload: NotificationPayload;
};

type Patch = Record<string, string | null>;
export async function deliverNotification(
  job: NotificationJob,
  dependencies: {
    send: (
      message: ReturnType<typeof notificationMessage>,
      key: string,
    ) => Promise<string>;
    save: (patch: Patch) => Promise<void>;
    now: () => Date;
  },
) {
  let providerId = job.provider_id;
  try {
    providerId ||= await dependencies.send(
      notificationMessage(job.payload),
      `lead-alert-${job.id}`,
    );
    await dependencies.save({
      state: "sent",
      provider_id: providerId,
      sent_at: dependencies.now().toISOString(),
      locked_at: null,
      claim_token: null,
      last_error: null,
    });
    return true;
  } catch {
    // Keep customer content and credentials out of logs/errors. Retain accepted
    // provider IDs so a failed bookkeeping update can be reconciled without resending.
    await dependencies.save({
      state: "pending",
      provider_id: providerId,
      locked_at: null,
      claim_token: null,
      last_error: providerId
        ? "Status update failed"
        : "Email delivery not confirmed",
      next_attempt_at: new Date(
        dependencies.now().getTime() +
          Math.min(60 * 2 ** Math.min(job.attempts, 6), 3600) * 1000,
      ).toISOString(),
    });
    return false;
  }
}
