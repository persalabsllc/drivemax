export { attentionCommand } from "./attention-schema";
import {
  canManage,
  dayKey,
  isOpenTask,
  myStaffId,
  visibleTasks,
  type Workspace,
} from "./model";

export type AttentionItem = {
  key: string;
  kind: "reply" | "failed" | "lead" | "website" | "task";
  id: string;
  customer_id: string | null;
  customer_name: string;
  opportunity_id: string | null;
  channel: "sms" | "email" | null;
  title: string;
  detail: string;
  created_at: string;
};
export type AttentionFeed = {
  emailQueue?: { pending: number };
  items: AttentionItem[];
  total: number;
  websiteIntake?: { connected: boolean; pending: number | null };
  websiteInventory?: { connected: boolean; pending: number };
};
export const attentionLabel = {
  reply: "Customer reply",
  failed: "Message failed",
  lead: "New lead",
  website: "Website inquiry",
  task: "Task due",
};

/** Mirrors the live, per-user feed for the isolated demo. */
export function demoAttention(ws: Workspace): AttentionFeed {
  const items: AttentionItem[] = [],
    manager = canManage(ws.member.role),
    me = myStaffId(ws);
  const allowed = (cid: string, oid?: string | null) =>
    manager ||
    (oid
      ? ws.opportunities.find((o) => o.id === oid)?.assigned_to
      : ws.customers.find((c) => c.id === cid)?.assigned_to) === me;
  for (const c of ws.customers.filter(
    (c) => c.status === "new" && allowed(c.id),
  )) {
    items.push({
      key: `lead:${c.id}`,
      kind: "lead",
      id: c.id,
      customer_id: c.id,
      customer_name: c.name,
      opportunity_id: null,
      channel: null,
      title: "New customer lead",
      detail: c.source,
      created_at: c.created_at,
    });
  }
  for (const m of ws.messages ?? []) {
    const kind =
      m.direction === "inbound" && m.status === "received"
        ? "reply"
        : m.direction === "outbound" && m.status === "failed"
          ? "failed"
          : null;
    if (!kind || !allowed(m.customer_id, m.opportunity_id)) continue;
    items.push({
      key: `${kind}:${m.id}`,
      kind,
      id: m.id,
      customer_id: m.customer_id,
      customer_name:
        ws.customers.find((c) => c.id === m.customer_id)?.name || "Customer",
      opportunity_id: m.opportunity_id,
      channel: m.channel,
      title: `${m.channel === "sms" ? "Text" : "Email"} ${kind === "reply" ? "received" : "delivery failed"}`,
      detail: (m.subject || m.body).slice(0, 160),
      created_at: m.updated_at,
    });
  }
  for (const t of visibleTasks(ws).filter(
    (t) => isOpenTask(t) && t.due_date <= dayKey(),
  )) {
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      id: t.id,
      customer_id: t.customer_id,
      customer_name:
        ws.customers.find((c) => c.id === t.customer_id)?.name || "Team task",
      opportunity_id: t.opportunity_id ?? null,
      channel: null,
      title: t.title,
      detail: `${t.due_date < dayKey() ? "Past due" : "Due today"} · ${t.due_date}`,
      created_at: t.due_date,
    });
  }
  const unread = items
    .filter(
      (i) =>
        i.kind === "task" ||
        !ws.attention_reviewed?.includes(`${ws.member.id}:${i.key}`),
    )
    .sort(
      (a, b) =>
        (a.kind === "reply" || a.kind === "failed" ? 0 : 1) -
          (b.kind === "reply" || b.kind === "failed" ? 0 : 1) ||
        b.created_at.localeCompare(a.created_at) ||
        b.key.localeCompare(a.key),
    );
  return { items: unread.slice(0, 100), total: unread.length };
}
