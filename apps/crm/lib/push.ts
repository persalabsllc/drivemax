import "server-only";
import webpush from "web-push";
import { db } from "./server";
export function validPushEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        u.hostname.endsWith(".push.apple.com") ||
        u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export async function dispatchPush() {
  if (process.env.VERCEL_ENV !== "production") return;
  const d = db(),
    { data: config, error } = await d
      .from("dmcrm_push_config")
      .select("public_key,private_key")
      .eq("id", "vapid")
      .maybeSingle();
  if (error || !config) return;
  const { data: jobs, error: e } = await d.rpc("dmcrm_push_claim");
  if (e) throw Error("Notification queue unavailable");
  for (const job of jobs ?? []) {
    const { data: subscriptions } = await d
      .from("dmcrm_push_subscriptions")
      .select("id,endpoint,keys")
      .eq("org_id", job.org_id)
      .eq("user_id", job.user_id);
    let retry = false;
    await Promise.all(
      (subscriptions ?? []).slice(0, 5).map(async (sub) => {
        if (!validPushEndpoint(sub.endpoint)) return;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: `Drive Max · ${job.event}`,
              body: "Open your CRM to review and take the next step.",
              tag: job.id,
              url: job.customer_id
                ? `/?customer=${job.customer_id}${job.opportunity_id ? `&opportunity=${job.opportunity_id}` : ""}`
                : "/?view=work",
            }),
            {
              vapidDetails: {
                subject: "mailto:sales@drivemaxusedcars.com",
                publicKey: config.public_key,
                privateKey: config.private_key,
              },
              TTL: 300,
              timeout: 7000,
            },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410)
            await d
              .from("dmcrm_push_subscriptions")
              .delete()
              .eq("id", sub.id)
              .eq("user_id", job.user_id);
          else retry = true;
        }
      }),
    );
    await d
      .from("dmcrm_push_jobs")
      .update({
        state: retry ? (job.attempts >= 3 ? "failed" : "pending") : "sent",
        claim_token: null,
        locked_at: null,
      })
      .eq("id", job.id)
      .eq("claim_token", job.claim_token);
  }
}
