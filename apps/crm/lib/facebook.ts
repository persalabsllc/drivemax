export type FacebookMessage = {
  id: string;
  org_id: string;
  customer_id: string;
  opportunity_id: string;
  body: string;
  referral: { ad_id?: string; ref?: string; source?: string };
  received_at: string;
};

export type FacebookEvent = {
  message_id: string;
  sender_id: string;
  body: string;
  received_at: string;
  referral: FacebookMessage["referral"];
  vehicle_id?: string;
  vin?: string;
};

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, max = 1000) => typeof v === "string" ? v.slice(0, max) : "";

/** Accept Page messages only. Echoes, delivery receipts and unrelated Pages are ignored. */
export function facebookEvents(payload: unknown, pageId: string, now = Date.now()): FacebookEvent[] {
  const root = object(payload);
  if (root.object !== "page" || !Array.isArray(root.entry)) return [];
  const events: FacebookEvent[] = [];
  for (const item of root.entry) {
    const entry = object(item);
    if (entry.id !== pageId || !Array.isArray(entry.messaging)) continue;
    for (const raw of entry.messaging) {
      const event = object(raw), message = object(event.message);
      const sender = str(object(event.sender).id, 100);
      const mid = str(message.mid);
      if (object(event.recipient).id !== pageId || !/^\d{1,100}$/.test(sender) || sender === pageId ||
          !mid || message.is_echo === true || message.is_deleted === true) continue;
      const text = str(message.text, 12000);
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const attachmentNote = attachments.length
        ? `\n[${attachments.length} attachment${attachments.length === 1 ? "" : "s"} received. View in Meta Business Suite.]` : "";
      const body = (text + attachmentNote).trim();
      if (!body) continue;
      const referralRaw = object(message.referral ?? event.referral);
      const referral = Object.fromEntries(["ad_id", "ref", "source"].map(k => [k, str(referralRaw[k])]).filter(([,v]) => !!v));
      const timestamp = typeof event.timestamp === "number" ? event.timestamp : now;
      const receivedAt = Number.isFinite(timestamp) && timestamp >= 946684800000 && timestamp <= now + 300000
        ? timestamp : now;
      const vehicle = /^vehicle:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(referral.ref || "");
      const vins = [...new Set(text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [])];
      events.push({ message_id: mid, sender_id: sender, body, referral,
        received_at: new Date(receivedAt).toISOString(),
        ...(vehicle ? { vehicle_id: vehicle[1] } : {}),
        ...(vins.length === 1 ? { vin: vins[0] } : {}),
      });
    }
  }
  return events;
}
