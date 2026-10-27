import {
  canManage,
  dayKey,
  myStaffId,
  type Customer,
  type Opportunity,
  type Workspace,
} from "./model";

export const funnelSteps = [
  {
    key: "leads",
    label: "New leads",
    detail: "Customers with a new opportunity created in this period.",
  },
  {
    key: "contacted",
    label: "Contacted",
    detail:
      "Logged calls, personal messages sent or received, and deals marked contacted. Automatic emails are excluded.",
  },
  {
    key: "appointments",
    label: "Appointments",
    detail:
      "Customers with appointments scheduled for this period. Canceled appointments are excluded.",
  },
  {
    key: "visits",
    label: "Visits",
    detail:
      "Customers who checked in or had an appointment marked arrived or completed in this period.",
  },
  {
    key: "sold",
    label: "Sold",
    detail:
      "Customers with a deal sold in this period. Unwound deals are excluded.",
  },
] as const;
export type FunnelStep = (typeof funnelSteps)[number]["key"];
export type FunnelCustomer = {
  customer: Customer;
  opportunity: Opportunity | null;
  at: string;
  opportunityIds: string[];
};

/** Activity counts, not conversion percentages: one customer per step, even with repeat deals. */
export function overviewFunnel(ws: Workspace, from: string, to: string) {
  const buckets = Object.fromEntries(
    funnelSteps.map(({ key }) => [key, new Map<string, FunnelCustomer>()]),
  ) as Record<FunnelStep, Map<string, FunnelCustomer>>;
  const customers = new Map(
    ws.customers.filter((c) => c.org_id === ws.org.id).map((c) => [c.id, c]),
  );
  const opportunities = new Map(
    ws.opportunities
      .filter((o) => o.org_id === ws.org.id)
      .map((o) => [o.id, o]),
  );
  function add(
    step: FunnelStep,
    customerId: string,
    opportunityId: string | null | undefined,
    at: string,
  ) {
    if (!at || !Number.isFinite(Date.parse(at))) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : dayKey(at);
    if (date < from || date > to) return;
    const customer = customers.get(customerId),
      opportunity = opportunityId ? opportunities.get(opportunityId) : null;
    if (
      !customer ||
      (opportunityId &&
        (!opportunity || opportunity.customer_id !== customerId))
    )
      return;
    if (
      !canManage(ws.member.role) &&
      (opportunity ? opportunity.assigned_to : customer.assigned_to) !==
        myStaffId(ws)
    )
      return;
    const existing = buckets[step].get(customerId);
    const ids = [
      ...new Set([
        ...(existing?.opportunityIds ?? []),
        ...(opportunity ? [opportunity.id] : []),
      ]),
    ];
    if (!existing || Date.parse(at) > Date.parse(existing.at))
      buckets[step].set(customerId, {
        customer,
        opportunity: opportunity ?? null,
        at,
        opportunityIds: ids,
      });
    else existing.opportunityIds = ids;
  }
  for (const o of opportunities.values()) {
    add("leads", o.customer_id, o.id, o.created_at);
    if (o.status === "sold" && o.sold_on)
      add("sold", o.customer_id, o.id, o.sold_on);
  }
  for (const a of ws.activities)
    if (a.kind === "call")
      add("contacted", a.customer_id, a.opportunity_id, a.created_at);
  for (const m of ws.messages ?? []) {
    const humanSent =
      m.direction === "outbound" &&
      ["sent", "delivered"].includes(m.status) &&
      m.created_by !== "00000000-0000-4000-8000-000000000000";
    if (humanSent || (m.direction === "inbound" && m.status === "received"))
      add(
        "contacted",
        m.customer_id,
        m.opportunity_id,
        humanSent ? m.updated_at : m.created_at,
      );
  }
  for (const event of ws.sales_events ?? []) {
    if (event.event === "contacted")
      add(
        "contacted",
        event.customer_id,
        event.opportunity_id,
        event.created_at,
      );
    if (event.event === "shown")
      add("visits", event.customer_id, event.opportunity_id, event.created_at);
  }
  for (const a of ws.appointments ?? []) {
    if (a.status !== "canceled")
      add("appointments", a.customer_id, a.opportunity_id, a.starts_at);
    if (["arrived", "completed"].includes(a.status))
      add("visits", a.customer_id, a.opportunity_id, a.starts_at);
  }
  for (const visit of ws.visits)
    add("visits", visit.customer_id, visit.opportunity_id, visit.arrived_at);
  return Object.fromEntries(
    funnelSteps.map(({ key }) => [
      key,
      [...buckets[key].values()].sort(
        (a, b) =>
          b.at.localeCompare(a.at) ||
          a.customer.name.localeCompare(b.customer.name),
      ),
    ]),
  ) as Record<FunnelStep, FunnelCustomer[]>;
}
