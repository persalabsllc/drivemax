import { z } from "zod";
import {
  canManage,
  dayKey,
  isOpenTask,
  myStaffId,
  opportunityOpen,
  type Workspace,
  type Opportunity,
} from "./model";
import { vehicleName, type InventoryVehicle } from "./vehicles";
export const salesStages = {
  new: "New lead",
  contacted: "Contacted",
  appointment: "Appointment set",
  shown: "Shown / test driven",
  numbers: "Working numbers",
  delivery: "Awaiting delivery",
} as const;
export const prepStages = {
  intake: "Intake",
  inspection: "Inspection",
  repair: "Repairs",
  detail: "Detail / photos",
  ready: "Ready to sell",
  published: "Published",
} as const;
export const fundingStages = {
  cash: "Cash deal",
  not_started: "Not submitted",
  submitted: "Submitted",
  approved: "Approved",
  stipulations: "Stipulations needed",
  contracted: "Contracted",
  funded: "Funded",
} as const;
export const progressSchema = z.object({
  stage: z.enum(
    Object.keys(salesStages) as [
      keyof typeof salesStages,
      ...(keyof typeof salesStages)[],
    ],
  ),
  funding: z.enum(
    Object.keys(fundingStages) as [
      keyof typeof fundingStages,
      ...(keyof typeof fundingStages)[],
    ],
  ),
  lender: z.string().trim().max(150),
  stipulations: z.string().trim().max(3000),
  funded_on: z.union([z.iso.date(), z.literal("")]),
  credit_url: z.union([
    z.literal(""),
    z
      .url()
      .refine(
        (v) => v.startsWith("https://"),
        "Use an HTTPS credit application link.",
      ),
  ]),
  delivery: z.record(z.string().max(100), z.boolean()),
  notes: z.string().trim().max(3000),
});
export type DealProgress = z.infer<typeof progressSchema> & {
  id: string;
  org_id: string;
  revision: number;
  updated_at: string;
};
export const emptyProgress: z.infer<typeof progressSchema> = {
  stage: "new",
  funding: "not_started",
  lender: "",
  stipulations: "",
  funded_on: "",
  credit_url: "",
  delivery: {},
  notes: "",
};
export const preferencesSchema = z.object({
  active: z.boolean(),
  max_price: z.number().min(0).max(1000000).nullable(),
  max_miles: z.number().int().min(0).max(3000000).nullable(),
  min_year: z.number().int().min(1900).max(2100).nullable(),
  make: z.string().trim().max(100),
  model: z.string().trim().max(100),
  body: z.string().trim().max(100),
  transmission: z.string().trim().max(100),
  features: z.string().trim().max(2000),
  notes: z.string().trim().max(2000),
});
export type BuyerPreference = z.infer<typeof preferencesSchema> & {
  id: string;
  org_id: string;
  revision: number;
};
export const emptyPreferences: z.infer<typeof preferencesSchema> = {
  active: true,
  max_price: null,
  max_miles: null,
  min_year: null,
  make: "",
  model: "",
  body: "",
  transmission: "",
  features: "",
  notes: "",
};
export const prepSchema = z.object({
  stage: z.enum(
    Object.keys(prepStages) as [
      keyof typeof prepStages,
      ...(keyof typeof prepStages)[],
    ],
  ),
  assigned_to: z.uuid().nullable(),
  due_on: z.union([z.iso.date(), z.literal("")]),
  title_received: z.boolean(),
  blocker: z.string().trim().max(2000),
  body: z.string().trim().max(100),
  transmission: z.string().trim().max(100),
  features: z.string().trim().max(2000),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        description: z.string().trim().min(1).max(200),
        vendor: z.string().trim().max(150),
        amount: z.number().min(0).max(1000000),
        due_on: z.union([z.iso.date(), z.literal("")]),
        done: z.boolean(),
      }),
    )
    .max(50),
});
export type InventoryPrep = z.infer<typeof prepSchema> & {
  id: string;
  org_id: string;
  revision: number;
  updated_at: string;
};
export const emptyPrep: z.infer<typeof prepSchema> = {
  stage: "intake",
  assigned_to: null,
  due_on: "",
  title_received: false,
  blocker: "",
  body: "",
  transmission: "",
  features: "",
  items: [],
};
export type SalesEvent = {
  id: string;
  org_id: string;
  opportunity_id: string;
  customer_id: string;
  event: string;
  created_at: string;
};
export type DealFile = {
  id: string;
  org_id: string;
  customer_id: string;
  opportunity_id: string | null;
  name: string;
  kind: string;
  size: number;
  created_at: string;
  created_by: string;
};
export const salesWorkCommands = [
  z.object({
    type: z.literal("save_deal_progress"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    progress: progressSchema,
  }),
  z.object({
    type: z.literal("save_buyer_preferences"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    preferences: preferencesSchema,
  }),
  z.object({
    type: z.literal("save_inventory_prep"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    prep: prepSchema,
    sync_recon: z.boolean(),
  }),
] as const;
export type WorkItem = {
  key: string;
  kind:
    | "reply"
    | "lead"
    | "appointment"
    | "task"
    | "next_step"
    | "quote"
    | "funding";
  customer_id: string | null;
  opportunity_id: string | null;
  assigned_to: string | null;
  title: string;
  detail: string;
  priority: number;
  at: string;
  task_id?: string;
  appointment_id?: string;
  channel?: "email" | "sms";
};
export function workToday(
  ws: Workspace,
  now = new Date(),
  scope = "all",
): WorkItem[] {
  const today = dayKey(now),
    me = myStaffId(ws),
    manager = canManage(ws.member.role);
  const allowed = (id: string | null | undefined) =>
    manager
      ? scope === "all" || (scope === "unassigned" ? !id : id === scope)
      : id === me;
  const out: WorkItem[] = [];
  const opportunities = ws.opportunities.filter((o) => allowed(o.assigned_to));
  for (const o of opportunities) {
    const c = ws.customers.find((c) => c.id === o.customer_id);
    if (!c) continue;
    const primary = ws.opportunities
      .filter((candidate) => candidate.customer_id === c.id)
      .sort(
        (a, b) =>
          Number(opportunityOpen(b)) - Number(opportunityOpen(a)) ||
          b.created_at.localeCompare(a.created_at),
      )[0];
    const messages = (ws.messages ?? [])
      .filter(
        (m) =>
          m.customer_id === c.id &&
          (m.opportunity_id === o.id ||
            (!m.opportunity_id && primary?.id === o.id)),
      )
      .filter((m) => ["received", "sent", "delivered"].includes(m.status))
      .sort((a, b) =>
        (b.direction === "outbound"
          ? b.updated_at
          : b.created_at
        ).localeCompare(
          a.direction === "outbound" ? a.updated_at : a.created_at,
        ),
      );
    const inbound = messages.find((m) => m.direction === "inbound");
    const human = messages.find(
      (m) =>
        m.direction === "outbound" &&
        m.created_by !== "00000000-0000-4000-8000-000000000000",
    );
    const calls = ws.activities
      .filter((a) => a.opportunity_id === o.id && a.kind === "call")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const lastContact = [human?.updated_at, calls[0]?.created_at]
      .filter(Boolean)
      .sort()
      .at(-1);
    const add = (
      item: Omit<
        WorkItem,
        "key" | "customer_id" | "opportunity_id" | "assigned_to"
      >,
    ) =>
      out.push({
        ...item,
        key: `${item.kind}:${o.id}`,
        customer_id: c.id,
        opportunity_id: o.id,
        assigned_to: o.assigned_to ?? null,
      });
    if (inbound && (!lastContact || inbound.created_at > lastContact))
      add({
        kind: "reply",
        title: "Customer is waiting for a reply",
        detail: inbound.subject || inbound.body.slice(0, 140),
        priority: 0,
        at: inbound.created_at,
        channel: inbound.channel,
      });
    if (!opportunityOpen(o)) continue;
    if (
      !lastContact &&
      !ws.sales_events?.some(
        (e) => e.opportunity_id === o.id && e.event === "contacted",
      )
    )
      add({
        kind: "lead",
        title: "No personal contact recorded",
        detail: o.vehicle_interest || o.source,
        priority: 2,
        at: o.created_at,
      });
    const next =
      ws.tasks.some((t) => t.opportunity_id === o.id && isOpenTask(t)) ||
      (ws.appointments ?? []).some(
        (a) =>
          a.opportunity_id === o.id &&
          ["scheduled", "confirmed"].includes(a.status) &&
          Date.parse(a.starts_at) > now.getTime(),
      );
    if (!next)
      add({
        kind: "next_step",
        title: "Choose a next action",
        detail: "No open task or future appointment",
        priority: 4,
        at: o.updated_at,
      });
    const q = ws.quotes
      .filter((q) => q.opportunity_id === o.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (
      q &&
      now.getTime() - Date.parse(q.created_at) > 2 * 86400000 &&
      (!lastContact || lastContact < q.created_at)
    )
      add({
        kind: "quote",
        title: "Follow up on the proposal",
        detail: o.vehicle_interest,
        priority: 3,
        at: q.created_at,
      });
  }
  for (const a of ws.appointments ?? [])
    if (
      allowed(a.assigned_to) &&
      ["scheduled", "confirmed", "arrived"].includes(a.status) &&
      dayKey(a.starts_at) <= today
    )
      out.push({
        key: `appointment:${a.id}`,
        kind: "appointment",
        customer_id: a.customer_id,
        opportunity_id: a.opportunity_id,
        assigned_to: a.assigned_to,
        appointment_id: a.id,
        title:
          dayKey(a.starts_at) < today
            ? "Record appointment outcome"
            : "Appointment today",
        detail: a.description,
        priority: 1,
        at: a.starts_at,
      });
  for (const t of ws.tasks)
    if (allowed(t.assigned_to) && isOpenTask(t) && t.due_date <= today)
      out.push({
        key: `task:${t.id}`,
        kind: "task",
        customer_id: t.customer_id,
        opportunity_id: t.opportunity_id ?? null,
        assigned_to: t.assigned_to ?? null,
        task_id: t.id,
        title: t.title,
        detail: t.due_date < today ? "Past due" : "Due today",
        priority: t.due_date < today ? 1 : 3,
        at: t.due_date + "T12:00:00Z",
      });
  for (const p of ws.deal_progress ?? []) {
    const o = ws.opportunities.find((o) => o.id === p.id);
    if (
      o?.status === "sold" &&
      allowed(o.assigned_to) &&
      ["submitted", "approved", "stipulations", "contracted"].includes(
        p.funding,
      )
    )
      out.push({
        key: `funding:${o.id}`,
        kind: "funding",
        customer_id: o.customer_id,
        opportunity_id: o.id,
        assigned_to: o.assigned_to ?? null,
        title: "Funding needs attention",
        detail: p.stipulations || fundingStages[p.funding],
        priority: 4,
        at: p.updated_at,
      });
  }
  // General messages without an opportunity still need a response.
  for (const c of ws.customers.filter(
    (c) =>
      allowed(c.assigned_to) &&
      !ws.opportunities.some((o) => o.customer_id === c.id),
  )) {
    const messages = (ws.messages ?? [])
      .filter(
        (m) =>
          m.customer_id === c.id &&
          ["received", "sent", "delivered"].includes(m.status),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const last = messages.find(
      (m) =>
        m.direction === "inbound" ||
        m.created_by !== "00000000-0000-4000-8000-000000000000",
    );
    if (last?.direction === "inbound")
      out.push({
        key: `reply:${c.id}`,
        kind: "reply",
        customer_id: c.id,
        opportunity_id: null,
        assigned_to: c.assigned_to ?? null,
        title: "Customer is waiting for a reply",
        detail: last.subject || last.body.slice(0, 140),
        priority: 0,
        at: last.created_at,
        channel: last.channel,
      });
  }
  return out.sort(
    (a, b) => a.priority - b.priority || a.at.localeCompare(b.at),
  );
}
export function matchInventory(
  p: BuyerPreference,
  inventory: InventoryVehicle[],
  prep: InventoryPrep[] = [],
) {
  const contains = (actual: string, wanted: string) =>
    !wanted || actual.toLowerCase().includes(wanted.toLowerCase());
  return inventory
    .filter(
      (v) =>
        v.status === "in_stock" &&
        (!p.max_price || v.price <= p.max_price) &&
        (!p.max_miles || v.mileage <= p.max_miles) &&
        (!p.min_year || v.year >= p.min_year) &&
        contains(v.make, p.make) &&
        contains(v.model, p.model),
    )
    .map((v) => {
      const info = prep.find((p) => p.id === v.id);
      const checks = [
        p.body && !contains(info?.body ?? "", p.body) ? "body style" : null,
        p.transmission && !contains(info?.transmission ?? "", p.transmission)
          ? "transmission"
          : null,
        p.features ? "requested features" : null,
      ].filter(Boolean);
      return { vehicle: v, verify: checks as string[], label: vehicleName(v) };
    });
}
export function deliveryChecks(ws: Workspace, o: Opportunity) {
  const c = ws.customers.find((c) => c.id === o.customer_id);
  const effective = o.sale_snapshot?.customer ?? c;
  const quote = ws.quotes
    .filter((q) => q.opportunity_id === o.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const vehicle =
    o.vehicle_details ?? ws.inventory.find((v) => v.id === o.inventory_id);
  return [
    {
      key: "buyer",
      label: "Buyer name and mailing address",
      ready: !!(
        effective?.person?.first_name &&
        effective?.person?.last_name &&
        effective?.person?.address1 &&
        effective?.person?.city &&
        effective?.person?.state &&
        effective?.person?.zip
      ),
    },
    {
      key: "vehicle",
      label: "VIN and current odometer",
      ready: !!(vehicle?.vin && vehicle.mileage != null),
    },
    { key: "quote", label: "Saved deal figures and products", ready: !!quote },
    {
      key: "insurance",
      label: "Insurance information",
      ready: !!(
        effective?.insurance?.company && effective?.insurance?.policy_number
      ),
    },
    {
      key: "trade",
      label: "Trade identity and payoff reviewed",
      ready: !o.trade_vehicle || !!(o.trade?.vin && o.trade.payoff != null),
    },
  ];
}
