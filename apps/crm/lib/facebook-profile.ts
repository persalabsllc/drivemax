import "server-only";
import { db } from "./server";

/** Names are optional enrichment. Missing Meta profile access never drops a lead. */
export async function refreshFacebookName(org: string, page: string, sender: string) {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token || !/^\d{1,100}$/.test(sender)) return;
  try {
    const response = await fetch(`https://graph.facebook.com/v25.0/${sender}?fields=first_name,last_name`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), cache: "no-store",
    });
    if (!response.ok) return;
    const profile = await response.json();
    const name = [profile.first_name,profile.last_name].filter(v=>typeof v === "string").join(" ").trim().slice(0,250);
    if (name) await db().rpc("dmcrm_facebook_name", {p_org:org,p_page:page,p_sender:sender,p_name:name});
  } catch { /* A later incoming message can retry enrichment. Never log credentials. */ }
}
