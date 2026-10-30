import { z } from "zod";
import type { Workspace } from "./model";
import { vehicleName } from "./vehicles";

const text = z.string().trim().max(250);
const notes = z.string().trim().max(4000);
const money = z
  .number()
  .finite()
  .min(0)
  .max(1000000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001,
    "Use dollars and cents.",
  );
export const serviceKinds = {
  reconditioning: "Inventory recon",
  we_owe: "We Owe",
  customer_pay: "Customer pay",
  warranty: "Warranty / goodwill",
} as const;
export const serviceStatuses = {
  draft: "Draft",
  awaiting_approval: "Awaiting authorization",
  approved: "Authorized",
  in_progress: "In progress",
  waiting_parts: "Waiting on parts",
  ready: "Ready for pickup",
  completed: "Completed",
  canceled: "Canceled",
} as const;
export const serviceLineSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["labor", "parts", "sublet", "fee"]),
  description: text.min(1, "Describe each repair item."),
  quantity: z.number().finite().min(0.01).max(10000).multipleOf(0.01),
  estimated_cost: money,
  actual_cost: money.nullable(),
  price: money,
});
export const serviceOrderSchema = z
  .object({
    kind: z.enum(["reconditioning", "we_owe", "customer_pay", "warranty"]),
    customer_id: z.uuid().nullable(),
    opportunity_id: z.uuid().nullable(),
    inventory_id: z.uuid().nullable(),
    vehicle: text.min(1, "Enter a vehicle."),
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .max(17)
      .refine(
        (v) => !v || /^[A-HJ-NPR-Z0-9]{17}$/.test(v),
        "Check the 17-character VIN.",
      ),
    stock_number: text,
    mileage: z.number().int().min(0).max(3000000).nullable(),
    assigned_to: z.uuid().nullable(),
    vendor: text,
    due_on: z.iso.date().nullable(),
    concern: notes.min(1, "Describe the work or customer promise."),
    findings: notes,
    items: z
      .array(serviceLineSchema)
      .min(1, "Add at least one labor, part, or repair item.")
      .max(50),
    tax: money,
    internal_notes: notes,
  })
  .refine(
    (v) => (v.kind === "reconditioning" ? !!v.inventory_id : !!v.customer_id),
    "Select inventory for recon, or a customer for service and promises.",
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.id)).size === v.items.length,
    "Repair items must have unique IDs.",
  )
  .refine(
    (v) =>
      Object.values(serviceTotals(v)).every((x) => x === null || x <= 1000000),
    "Order totals cannot exceed $1,000,000.",
  );
export type ServiceLine = z.infer<typeof serviceLineSchema>;
export type ServiceInput = z.infer<typeof serviceOrderSchema>;
export type ServiceAuthorization = {
  by: string;
  method: "in_person" | "phone" | "email" | "written" | "internal";
  limit: number;
  notes: string;
  at: string;
  actor: string;
};
export type ServiceOrder = ServiceInput & {
  id: string;
  org_id: string;
  order_number: number;
  customer_name: string;
  status: keyof typeof serviceStatuses;
  authorization: ServiceAuthorization | null;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  canceled_reason: string;
  created_by: string;
};
export type ServiceReceipt = {
  id: string;
  org_id: string;
  order_id: string;
  amount: number;
  received_on: string;
  method: string;
  reference: string;
  reversal_of: string | null;
  notes: string;
  created_by: string;
  created_at: string;
};
export type OperationsEvent = {
  id: string;
  org_id: string;
  subject_id: string;
  action: string;
  command: Record<string, unknown>;
  before_value: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
};
const base = {
  id: z.uuid(),
  request_id: z.uuid(),
  revision: z.number().int().min(0),
};
export const serviceCommands = [
  z.object({
    type: z.literal("save_service_order"),
    ...base,
    order: serviceOrderSchema,
  }),
  z.object({
    type: z.literal("authorize_service_order"),
    ...base,
    by: text.min(1),
    method: z.enum(["in_person", "phone", "email", "written", "internal"]),
    limit: money,
    notes,
  }),
  z.object({
    type: z.literal("set_service_status"),
    ...base,
    status: z.enum([
      "draft",
      "awaiting_approval",
      "approved",
      "in_progress",
      "waiting_parts",
      "ready",
      "completed",
      "canceled",
    ]),
    reason: notes,
  }),
  z.object({
    type: z.literal("record_service_receipt"),
    ...base,
    receipt_id: z.uuid(),
    amount: money.refine((v) => v > 0, "Enter an amount greater than zero."),
    received_on: z.iso.date(),
    method: z.enum(["Cash", "Check", "Card", "ACH", "Other"]),
    reference: text,
    notes,
  }),
  z.object({
    type: z.literal("reverse_service_receipt"),
    ...base,
    receipt_id: z.uuid(),
    original_id: z.uuid(),
    received_on: z.iso.date(),
    reason: notes.min(3),
  }),
  z.object({
    type: z.literal("apply_service_recon"),
    request_id: z.uuid(),
    inventory_id: z.uuid(),
    expected_updated_at: z.string().min(1).max(50),
    other_costs: money,
  }),
] as const;
export type ServiceCommand = z.infer<(typeof serviceCommands)[number]>;
export const round = (v: number) =>
  Math.round((v + Number.EPSILON) * 100) / 100;
export function serviceTotals(o: { items: ServiceLine[]; tax: number }) {
  const sum = (key: "estimated_cost" | "actual_cost" | "price") =>
    round(o.items.reduce((s, i) => s + round(i.quantity * (i[key] ?? 0)), 0));
  return {
    estimate: sum("estimated_cost"),
    actual: o.items.some((i) => i.actual_cost === null)
      ? null
      : sum("actual_cost"),
    subtotal: sum("price"),
    total: round(sum("price") + o.tax),
  };
}
export const serviceOpen = (o: ServiceOrder) =>
  !["completed", "canceled"].includes(o.status);
export function servicePaid(
  ws: Pick<Workspace, "service_receipts">,
  id: string,
) {
  return round(
    (ws.service_receipts ?? [])
      .filter((r) => r.order_id === id)
      .reduce((n, r) => n + (r.reversal_of ? -r.amount : r.amount), 0),
  );
}
export function serviceLabel(o: Pick<ServiceOrder, "order_number">) {
  return `RO-${String(o.order_number).padStart(6, "0")}`;
}
export function serviceScope(o: ServiceInput) {
  return JSON.stringify({
    kind: o.kind,
    customer_id: o.customer_id,
    inventory_id: o.inventory_id,
    opportunity_id: o.opportunity_id,
    vehicle: o.vehicle,
    vin: o.vin,
    concern: o.concern,
    items: o.items.map(({ actual_cost: _actual, ...i }) => i),
    tax: o.tax,
  });
}
export function serviceLimitBasis(o: ServiceInput) {
  const t = serviceTotals(o);
  return o.kind === "customer_pay" ? t.total : t.estimate;
}
export function serviceBlank(
  ws: Workspace,
  customerId?: string,
  opportunityId?: string,
  inventoryId?: string,
): ServiceInput {
  const opportunity = ws.opportunities.find((o) => o.id === opportunityId),
    v = ws.inventory.find(
      (i) => i.id === (inventoryId || opportunity?.inventory_id),
    );
  const prep = inventoryId
    ? ws.inventory_prep?.find((p) => p.id === inventoryId)
    : undefined;
  return {
    kind: inventoryId ? "reconditioning" : "we_owe",
    customer_id: customerId ?? null,
    opportunity_id: opportunityId ?? null,
    inventory_id: v?.id ?? null,
    vehicle: v ? vehicleName(v) : (opportunity?.vehicle_interest ?? ""),
    vin: v?.vin ?? opportunity?.vehicle_details?.vin ?? "",
    stock_number: v?.stock_number ?? "",
    mileage: v?.mileage ?? null,
    assigned_to: prep?.assigned_to ?? ws.member.staff_id ?? null,
    vendor: "",
    due_on: prep?.due_on || null,
    concern: prep?.blocker || "",
    findings: "",
    internal_notes: "",
    tax: 0,
    items: prep?.items.length
      ? prep.items.map((i) => ({
          id: crypto.randomUUID(),
          kind: "sublet" as const,
          description: i.description,
          quantity: 1,
          estimated_cost: i.amount,
          actual_cost: null,
          price: 0,
        }))
      : [
          {
            id: crypto.randomUUID(),
            kind: "labor",
            description: "",
            quantity: 1,
            estimated_cost: 0,
            actual_cost: null,
            price: 0,
          },
        ],
  };
}
export const managementErrors = [
  "Manager access required",
  "Record changed. Refresh before saving.",
  "Use a new request key for changed details.",
  "Record unavailable.",
  "Select an active team member.",
  "Customer, deal, or vehicle link is invalid.",
  "Completed or canceled orders cannot be edited.",
  "Record authorization before starting work.",
  "Authorization must cover the estimate.",
  "Enter actual costs before completing the order.",
  "Actual costs exceed the authorized budget. Record a new authorization.",
  "Enter a cancellation reason.",
  "Reverse receipts before canceling.",
  "Receipts can only be recorded for customer-pay orders.",
  "Receipt date cannot be in the future.",
  "Receipt unavailable or already reversed.",
  "Receipt correction exceeds recorded payments.",
  "Only available inventory recon can be updated.",
  "Complete a recon order before applying costs.",
  "Report settings are invalid.",
  "Order details are invalid.",
  "Too many saved reports.",
];
