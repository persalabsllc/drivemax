"use client";
import { RefreshCw, ExternalLink } from "lucide-react";
import type { Workspace } from "../lib/model";

export function FacebookThread({ ws, customerId, busy, onRefresh }: {
  ws: Workspace; customerId: string; busy: boolean; onRefresh?: () => Promise<void>;
}) {
  const messages = (ws.facebook_messages ?? []).filter(m => m.customer_id === customerId)
    .sort((a,b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
  return <div className="profile-body">
    <div className="section-heading"><div><h2>Facebook Messenger</h2>
      <p>Page messages and vehicle inquiries stay with this customer.</p></div>
      <div className="row-actions">
        <button className="btn small" disabled={busy} onClick={() => void onRefresh?.()}><RefreshCw size={14}/> Refresh</button>
        <a className="btn small" href="https://business.facebook.com/latest/inbox/all" target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Reply in Meta Inbox</a>
      </div>
    </div>
    <p className="ops-help">Replies are handled in Meta Business Suite. Facebook messages do not give permission to send customer texts.</p>
    {!messages.length && <p className="muted-copy">No Facebook messages received for this customer yet.</p>}
    <div className="facebook-thread" aria-label="Facebook message thread">{messages.map(m => <article className="facebook-message" key={m.id}>
      <div className="subtext">Received · {new Date(m.received_at).toLocaleString("en-US", {timeZone:"America/New_York"})}</div>
      <p className="facebook-message-body">{m.body}</p>
      <small className="subtext">{ws.opportunities.find(o=>o.id===m.opportunity_id)?.title || "Facebook inquiry"}
        {m.referral.ad_id ? ` · Ad ${m.referral.ad_id}` : ""}
        {m.referral.ref ? ` · Referral: ${m.referral.ref}` : ""}</small>
    </article>)}</div>
  </div>;
}
