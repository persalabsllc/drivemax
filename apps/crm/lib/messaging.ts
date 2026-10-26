import "server-only";
import type { EmailConnection } from "./email";
const workerUrl = "https://www.drivemaxusedcars.com/api/crm/email";
const dealershipOrg = "d5a1c100-0000-4000-8000-000000000001";
function headers() {
  return {
    Authorization: `Bearer ${process.env.CRM_EMAIL_WORKER_SECRET}`,
    "Content-Type": "application/json",
  };
}
export async function emailConnection(org: string): Promise<EmailConnection> {
  const offline = { connected: false, sender: "sales@drivemaxusedcars.com" };
  if (
    org !== dealershipOrg ||
    process.env.VERCEL_ENV !== "production" ||
    !process.env.CRM_EMAIL_WORKER_SECRET
  )
    return offline;
  try {
    const r = await fetch(workerUrl, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok)
      return {
        ...offline,
        reason:
          "Email connection is temporarily unavailable. Your drafts are safe.",
      };
    const data = await r.json();
    return {
      connected: data.connected === true,
      sender: data.sender || offline.sender,
    };
  } catch {
    return {
      ...offline,
      reason:
        "Email connection is temporarily unavailable. Your drafts are safe.",
    };
  }
}
export async function dispatchEmail(org: string, id?: string) {
  if (
    org !== dealershipOrg ||
    process.env.VERCEL_ENV !== "production" ||
    !process.env.CRM_EMAIL_WORKER_SECRET
  )
    return;
  try {
    await fetch(workerUrl, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(id ? { id } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(50000),
    });
  } catch {
    console.error("Email remains queued for the next delivery attempt.");
  }
}
