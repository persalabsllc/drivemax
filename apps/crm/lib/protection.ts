import { z } from "zod";
import type { Workspace, Quote, Customer } from "./model";
import { personFromCustomer } from "./people";
import { vinSchema, vehicleName } from "./vehicles";
import { fiSelectionMatches } from "./fi-menu";
import {
  protectionPlanIds,
  protectionKind,
  isMechanicalPlan,
} from "./protection-programs";
export { protectionPlans } from "./protection-programs";
export const ancillaryProtectionVersion = "DM-ANC-2026-10-v1";
export const protectionEdition = (plan: string) =>
  isMechanicalPlan(plan) ? protectionVersion : ancillaryProtectionVersion;

export const protectionVersion = "DM-VSC-2026-10-v1";
export const protectionIssuer = {
  name: "Drive Max Used Cars LLC",
  address: "6210 Old US Hwy 70 W, New Bern, NC 28562",
  phone: "252-541-0040",
};
export const protectionDeductibles = [0, 250, 500, 1000] as const;
const text = z.string().trim().max(250);
const amount = z.number().finite().min(0).max(1000000).multipleOf(0.01);
const date = z.iso.date().refine((s) => {
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Enter a valid calendar date.");
export const protectionInputSchema = z
  .object({
    customer_id: z.uuid(),
    opportunity_id: z.uuid().nullable(),
    quote_id: z.uuid().nullable(),
    product_id: z.uuid().nullable(),
    holder_name: text.min(1, "Enter the contract holder."),
    co_holder: text,
    address: text.min(1, "Enter the holder's street address."),
    city: text.min(1),
    state: z.literal("NC"),
    zip: z.string().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code."),
    phone: text.min(7, "Enter a contact phone number."),
    email: z.union([z.email().max(250), z.literal("")]),
    vin: vinSchema,
    year: z.number().int().min(1900).max(2100),
    make: text.min(1),
    model: text.min(1),
    stock_number: text,
    plan: z.enum(protectionPlanIds),
    deductible: z.union([
      z.literal(0),
      z.literal(250),
      z.literal(500),
      z.literal(1000),
    ]),
    price: amount.positive("Enter the contract price."),
    issued_on: date,
    start_miles: z.number().int().min(0).max(3000000),
    term_months: z.number().int().min(1).max(120),
    term_miles: z.number().int().min(1).max(3000000).nullable(),
    maintenance_visits: z.number().int().min(1).max(100).nullable().optional(),
    claim_limit: amount
      .positive("Enter the aggregate repair benefit limit.")
      .nullable(),
    lender: text,
    lender_address: text,
    dealer_sold: z.literal(true, {
      error: "Confirm this vehicle was sold by Drive Max.",
    }),
  })
  .superRefine((c, ctx) => {
    const mechanical = isMechanicalPlan(c.plan);
    if (
      (mechanical && (c.term_miles === null || c.claim_limit === null)) ||
      (!mechanical && c.deductible !== 0) ||
      (c.plan === "appearance" &&
        (c.term_months !== 96 || c.term_miles !== null)) ||
      (c.plan === "maintenance" &&
        (!c.maintenance_visits ||
          c.claim_limit !== c.maintenance_visits * 125)) ||
      (c.plan !== "maintenance" && c.maintenance_visits != null) ||
      (!mechanical && c.plan !== "maintenance" && c.claim_limit !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Contract benefits do not match the selected program.",
      });
  })
  .refine(
    (v) =>
      !!v.quote_id === !!v.product_id && (!v.quote_id || !!v.opportunity_id),
    "Select the saved proposal and product together.",
  );
export type ProtectionInput = z.infer<typeof protectionInputSchema>;
export type ProtectionCancellation = ReturnType<typeof protectionRefund> & {
  canceled_on: string;
  mileage: number;
  reason: string;
  payee: string;
  paid_on: string | null;
  payment_reference: string;
};
export type ProtectionContract = ProtectionInput & {
  id: string;
  org_id: string;
  contract_number: string;
  expires_on: string;
  expires_miles: number | null;
  batch_id?: string | null;
  status: "active" | "canceled";
  terms_version: string;
  issuer: typeof protectionIssuer;
  claims_paid: number;
  cancellation: ProtectionCancellation | null;
  revision: number;
  created_at: string;
  created_by: string;
};
export type ProtectionEvent = {
  id: string;
  org_id: string;
  contract_id: string;
  action: string;
  command: Record<string, unknown>;
  result: Record<string, unknown>;
  created_by: string;
  created_at: string;
};
export function protectionDraft(input: ProtectionInput): ProtectionContract {
  return {
    ...input,
    id: "00000000-0000-4000-8000-000000000000",
    org_id: "00000000-0000-4000-8000-000000000000",
    contract_number: "DRAFT",
    expires_on: protectionExpiry(input.issued_on, input.term_months),
    expires_miles:
      input.term_miles === null ? null : input.start_miles + input.term_miles,
    status: "active",
    terms_version: protectionEdition(input.plan),
    issuer: protectionIssuer,
    claims_paid: 0,
    cancellation: null,
    revision: 1,
    created_at: new Date().toISOString(),
    created_by: "00000000-0000-4000-8000-000000000000",
  };
}
const key = { request_id: z.uuid(), id: z.uuid() };
export const protectionBatchSchema = z
  .object({
    type: z.literal("issue_protection_batch"),
    ...key,
    contracts: z
      .array(z.object({ id: z.uuid(), contract: protectionInputSchema }))
      .min(1)
      .max(30),
  })
  .superRefine((p, ctx) => {
    if (!p.contracts.length) return;
    const first = protectionShared(p.contracts[0].contract);
    if (
      new Set(p.contracts.map((c) => c.id)).size !== p.contracts.length ||
      p.contracts.some((c) => c.id === p.id || c.id === p.request_id) ||
      p.id === p.request_id ||
      p.contracts.some(
        (c) =>
          JSON.stringify(protectionShared(c.contract)) !==
          JSON.stringify(first),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A contract packet must use one customer, vehicle and issue date, with unique contract IDs.",
      });
  });
export const protectionCommands = [
  protectionBatchSchema,
  z.object({
    type: z.literal("issue_protection"),
    ...key,
    contract: protectionInputSchema,
  }),
  z.object({
    type: z.literal("cancel_protection"),
    ...key,
    revision: z.number().int().min(1),
    canceled_on: date,
    mileage: z.number().int().min(0).max(6000000),
    reason: text.min(3),
    payee: text.min(1),
  }),
  z.object({
    type: z.literal("record_protection_claim"),
    ...key,
    revision: z.number().int().min(1),
    amount: amount.positive(),
    paid_on: date,
    reference: text.min(1),
    description: z.string().trim().min(3).max(2000),
    service_on: date.optional(),
    mileage: z.number().int().min(0).max(6000000).optional(),
    units: z.number().int().min(1).max(2).optional(),
  }),
  z.object({
    type: z.literal("record_protection_refund"),
    ...key,
    revision: z.number().int().min(1),
    paid_on: date,
    reference: text.min(1),
  }),
] as const;
export type ProtectionCommand = z.infer<(typeof protectionCommands)[number]>;
export const protectionErrors = [
  "Contract unavailable.",
  "Contract details are invalid.",
  "Contract changed. Refresh before continuing.",
  "Contract is already canceled.",
  "Contract dates or mileage are invalid.",
  "This product already has a contract.",
  "Save and select the current F&I menu before issuing coverage.",
  "Contract coverage must match the selected product.",
  "Refund has already been recorded or no refund is due.",
  "Paid claims exceed the contract benefit limit.",
  "Use a new request key for changed details.",
  "Manager access required",
  "A contract packet must use one customer, vehicle and issue date, with unique contract IDs.",
  "Contract all remaining selected Drive Max products together.",
  "Selected coverage differs from an issued contract. Restore the menu to the issued terms or use a new product for replacement coverage.",
  "Claim service date, mileage or quantity is outside coverage.",
  "Key replacement is limited to 3 keys total and 2 in any rolling 12-month period.",
  "Maintenance is limited to $125 per visit and the purchased visit count.",
  "This claim reference has already been recorded.",
];
export const protectionMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function protectionExpiry(start: string, months: number) {
  const [year, month, day] = start.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.toISOString().slice(0, 10);
}
export function protectionRefund(
  c: Pick<
    ProtectionContract,
    | "issued_on"
    | "expires_on"
    | "start_miles"
    | "term_miles"
    | "price"
    | "claims_paid"
  >,
  on: string,
  miles: number,
) {
  if (on < c.issued_on || miles < c.start_miles || !Number.isInteger(miles))
    throw Error("Contract dates or mileage are invalid.");
  const days = (s: string) => Date.parse(s + "T12:00:00Z") / 86400000;
  const elapsed_days = days(on) - days(c.issued_on),
    total_days = days(c.expires_on) - days(c.issued_on),
    miles_used = miles - c.start_miles,
    time_used = Math.min(1, elapsed_days / total_days),
    mileage_used =
      c.term_miles === null ? 0 : Math.min(1, miles_used / c.term_miles),
    used = Math.max(time_used, mileage_used),
    byTime =
      c.term_miles === null ||
      elapsed_days * c.term_miles >= miles_used * total_days,
    denominator = byTime ? total_days : c.term_miles!,
    remaining = Math.max(0, denominator - (byTime ? elapsed_days : miles_used)),
    prorated =
      Math.round((Math.round(c.price * 100) * remaining) / denominator) / 100,
    admin_fee = protectionMoney(Math.min(100, prorated * 0.1)),
    refund = protectionMoney(Math.max(0, prorated - admin_fee - c.claims_paid));
  return {
    elapsed_days,
    total_days,
    miles_used,
    time_used,
    mileage_used,
    used,
    prorated,
    admin_fee,
    claims_paid: c.claims_paid,
    refund,
  };
}
export const protectionLabel = (c: ProtectionContract, today: string) =>
  c.status === "canceled"
    ? "Canceled"
    : c.expires_on <= today
      ? "Term ended"
      : "Active";
export function selectedProtectionProducts(q: Quote) {
  return fiSelectionMatches(q.values)
    ? (q.values.products ?? []).filter(
        (p) =>
          p.protection_plan && p.kind === protectionKind(p.protection_plan),
      )
    : [];
}
export function protectionDefaults(
  c?: Customer,
  q?: Quote,
): Partial<ProtectionInput> {
  const p = c ? personFromCustomer(c) : null;
  const v = q?.vehicle_details ?? c?.vehicle_details;
  return {
    customer_id: c?.id,
    opportunity_id: q?.opportunity_id ?? null,
    quote_id: null,
    product_id: null,
    holder_name: c?.name ?? "",
    co_holder: c?.co_buyer
      ? [c.co_buyer.first_name, c.co_buyer.last_name].filter(Boolean).join(" ")
      : "",
    address: [p?.address1, p?.address2].filter(Boolean).join(", "),
    city: p?.city ?? "",
    state: "NC",
    zip: p?.zip ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    vin: v?.vin ?? "",
    year: v?.year ?? undefined,
    make: v?.make ?? "",
    model: v ? vehicleName({ ...v, year: null, make: "" }) : "",
    stock_number: v?.stock_number ?? "",
    plan: "deluxe",
    deductible: 0,
    start_miles: v?.mileage ?? undefined,
    claim_limit: q?.values.price || v?.price || undefined,
    lender: "",
    lender_address: "",
  };
}
export function validateProtectionSource(ws: Workspace, c: ProtectionInput) {
  if (
    !ws.customers.some((x) => x.id === c.customer_id) ||
    (c.opportunity_id &&
      !ws.opportunities.some(
        (x) => x.id === c.opportunity_id && x.customer_id === c.customer_id,
      ))
  )
    throw Error("Contract details are invalid.");
  if (!c.quote_id) return;
  const q = ws.quotes.find(
    (q) =>
      q.id === c.quote_id &&
      q.opportunity_id === c.opportunity_id &&
      q.customer_id === c.customer_id,
  );
  const o = ws.opportunities.find((o) => o.id === c.opportunity_id);
  const latest =
    o?.status === "sold"
      ? o.sale_snapshot?.quote
      : ws.quotes
          .filter(
            (q) =>
              q.opportunity_id === c.opportunity_id &&
              (q.inventory_id ?? null) === o?.inventory_id &&
              (!!o?.inventory_id || q.vehicle === o?.vehicle_interest),
          )
          .sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          )[0];
  if (
    !q ||
    latest?.id !== q.id ||
    !fiSelectionMatches(q.values) ||
    o?.status === "lost"
  )
    throw Error(
      "Save and select the current F&I menu before issuing coverage.",
    );
  const product = selectedProtectionProducts(q).find(
    (p) => p.id === c.product_id,
  );
  if (
    !product ||
    !protectionProductMatches(product, c) ||
    (q.vehicle_details?.vin && q.vehicle_details.vin !== c.vin)
  )
    throw Error("Contract coverage must match the selected product.");
  if (
    ws.protection_contracts?.some(
      (x) =>
        x.opportunity_id === c.opportunity_id && x.product_id === c.product_id,
    )
  )
    throw Error("This product already has a contract.");
}

// Fields shared by every contract in an issuance packet. Coverage is per product.
export function protectionShared(c: ProtectionInput) {
  const {
    plan,
    deductible,
    price,
    term_months,
    term_miles,
    claim_limit,
    maintenance_visits,
    product_id,
    ...shared
  } = c;
  return shared;
}
export function protectionProductMatches(
  p: import("./operations").FIProduct,
  c: ProtectionInput,
) {
  return (
    p.protection_plan === c.plan &&
    p.price === c.price &&
    p.deductible === c.deductible &&
    p.term_months === c.term_months &&
    (p.unlimited_miles ? null : p.mileage_limit) === c.term_miles &&
    (p.maintenance_visits ?? null) === (c.maintenance_visits ?? null) &&
    (p.claim_limit === undefined || p.claim_limit === c.claim_limit)
  );
}
export function protectionProductInput(p: import("./operations").FIProduct) {
  return {
    product_id: p.id,
    plan: p.protection_plan!,
    deductible: p.deductible,
    price: p.price,
    term_months: p.term_months,
    term_miles: p.unlimited_miles ? null : p.mileage_limit,
    maintenance_visits: p.maintenance_visits ?? null,
    claim_limit: isMechanicalPlan(p.protection_plan!)
      ? p.claim_limit
      : p.protection_plan === "maintenance"
        ? (p.maintenance_visits ?? 0) * 125
        : null,
  };
}
export function validateProtectionBatch(
  ws: Workspace,
  batch: z.infer<typeof protectionBatchSchema>,
) {
  const c = batch.contracts[0].contract;
  if (!c.quote_id) return;
  const q = ws.quotes.find((q) => q.id === c.quote_id);
  if (!q)
    throw Error(
      "Save and select the current F&I menu before issuing coverage.",
    );
  const products = selectedProtectionProducts(q);
  const existing = ws.protection_contracts ?? [];
  for (const p of products) {
    const issued = existing.find(
      (x) => x.opportunity_id === c.opportunity_id && x.product_id === p.id,
    );
    if (issued && !protectionProductMatches(p, issued))
      throw Error(
        "Selected coverage differs from an issued contract. Restore the menu to the issued terms or use a new product for replacement coverage.",
      );
  }
  const remaining = products
    .filter(
      (p) =>
        !existing.some(
          (x) => x.opportunity_id === c.opportunity_id && x.product_id === p.id,
        ),
    )
    .map((p) => p.id)
    .sort();
  if (
    JSON.stringify(remaining) !==
    JSON.stringify(batch.contracts.map((x) => x.contract.product_id).sort())
  )
    throw Error("Contract all remaining selected Drive Max products together.");
}
export function protectionUsage(
  c: ProtectionContract,
  events: ProtectionEvent[],
) {
  return events
    .filter(
      (e) => e.contract_id === c.id && e.action === "record_protection_claim",
    )
    .map((e) => ({
      on: String(e.command.service_on ?? e.command.paid_on),
      units: Number(e.command.units ?? 1),
    }));
}
export function validateProtectionClaim(
  c: ProtectionContract,
  p: Extract<ProtectionCommand, { type: "record_protection_claim" }>,
  events: ProtectionEvent[],
  today: string,
) {
  if (p.paid_on < c.issued_on || p.paid_on > today)
    throw Error("Contract dates or mileage are invalid.");
  if (
    c.claim_limit !== null &&
    protectionMoney(c.claims_paid + p.amount) > c.claim_limit
  )
    throw Error("Paid claims exceed the contract benefit limit.");
  if (isMechanicalPlan(c.plan) && p.service_on === undefined) return; // Original VSC payment ledger remains compatible.
  if (
    !p.service_on ||
    p.service_on < c.issued_on ||
    p.service_on >= c.expires_on ||
    p.service_on > p.paid_on ||
    p.mileage === undefined ||
    p.mileage < c.start_miles ||
    (c.expires_miles !== null && p.mileage >= c.expires_miles) ||
    !p.units ||
    (c.plan !== "key_replacement" && p.units !== 1)
  )
    throw Error("Claim service date, mileage or quantity is outside coverage.");
  if (
    events.some(
      (e) =>
        e.contract_id === c.id &&
        e.action === "record_protection_claim" &&
        String(e.command.reference).trim().toLowerCase() ===
          p.reference.trim().toLowerCase(),
    )
  )
    throw Error("This claim reference has already been recorded.");
  const usage = [
    ...protectionUsage(c, events),
    { on: p.service_on, units: p.units },
  ];
  if (
    c.plan === "key_replacement" &&
    (usage.reduce((n, u) => n + u.units, 0) > 3 ||
      usage.some(
        (start) =>
          usage
            .filter(
              (u) => u.on >= start.on && u.on < protectionExpiry(start.on, 12),
            )
            .reduce((n, u) => n + u.units, 0) > 2,
      ))
  )
    throw Error(
      "Key replacement is limited to 3 keys total and 2 in any rolling 12-month period.",
    );
  if (
    c.plan === "maintenance" &&
    (p.amount > 125 || usage.length > (c.maintenance_visits ?? 0))
  )
    throw Error(
      "Maintenance is limited to $125 per visit and the purchased visit count.",
    );
}
export const protectionTermLabel = (
  c: Pick<ProtectionInput, "term_months" | "term_miles">,
) =>
  `${c.term_months} months / ${c.term_miles === null ? "Unlimited miles" : `${c.term_miles.toLocaleString()} additional miles`}`;
