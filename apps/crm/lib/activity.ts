import { fullMoney, type Activity, type Workspace } from "./model";

export type TimelineEntry = Activity & { label: string; context: string };

/** A single chronological view across every opportunity and general correspondence. */
export function customerActivity(
  ws: Workspace,
  customerId: string,
): TimelineEntry[] {
  const context = (id?: string | null) =>
    ws.opportunities.find((o) => o.id === id)?.title || "Customer profile";
  const entries: TimelineEntry[] = ws.activities
    .filter((a) => a.customer_id === customerId)
    .map((a) => ({
      ...a,
      id: `activity:${a.id}`,
      context: context(a.opportunity_id),
      label: {
        note: "Note",
        call: "Phone call",
        sms: "Text message log",
        email: "Email log",
        system: "Update",
      }[a.kind],
    }));
  for (const m of ws.messages ?? []) {
    if (m.customer_id !== customerId) continue;
    const status =
      m.status === "draft"
        ? "Draft · not sent"
        : m.status === "canceled"
          ? "Draft removed · not sent"
          : m.direction === "inbound"
            ? "Received"
            : {
                queued: "Queued · awaiting delivery",
                sent: "Sent",
                delivered: "Delivered",
                failed: "Failed · not delivered",
                received: "Received",
              }[m.status];
    entries.push({
      id: `message:${m.id}`,
      org_id: m.org_id,
      customer_id: customerId,
      opportunity_id: m.opportunity_id,
      kind: m.channel,
      label: `${m.channel === "email" ? "Email" : "Text"} · ${status}`,
      context: context(m.opportunity_id),
      body: [
        m.subject,
        m.body,
        m.status === "failed"
          ? "Delivery failed. Review this message in its conversation."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      created_at:
        m.direction === "outbound" && !["draft", "canceled"].includes(m.status)
          ? m.updated_at
          : m.created_at,
      created_by:
        m.direction === "inbound"
          ? "Customer"
          : ws.staff.find((s) => s.user_id === m.created_by)?.name ||
            "Dealership",
    });
  }
  for (const m of ws.facebook_messages ?? []) {
    if (m.customer_id !== customerId) continue;
    entries.push({id:`facebook:${m.id}`,org_id:m.org_id,customer_id:customerId,
      opportunity_id:m.opportunity_id,kind:"system",label:"Facebook message received",
      context:context(m.opportunity_id),body:m.body,created_at:m.received_at,created_by:"Facebook customer"});
  }
  for (const q of ws.quotes.filter((q) => q.customer_id === customerId)) {
    entries.push({
      id: `quote:${q.id}`,
      org_id: q.org_id,
      customer_id: customerId,
      opportunity_id: q.opportunity_id,
      kind: "system",
      label: "Desking version saved",
      context: context(q.opportunity_id),
      body: `${q.vehicle || "Vehicle to be selected"} · Sales price ${fullMoney(q.values.price)}`,
      created_at: q.created_at,
      created_by: "Saved proposal",
    });
  }
  return entries.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}
