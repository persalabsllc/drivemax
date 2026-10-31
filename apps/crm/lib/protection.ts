import { z } from "zod";
import type { Workspace, Quote, Customer } from "./model";
import { personFromCustomer } from "./people";
import { vinSchema, vehicleName } from "./vehicles";
import { fiSelectionMatches } from "./fi-menu";

export const protectionVersion = "DM-VSC-2026-10-v1";
export const protectionIssuer = {
  name: "Drive Max Used Cars LLC",
  address: "6210 Old US Hwy 70 W, New Bern, NC 28562",
  phone: "252-541-0040",
};
export const protectionPlans = {
  deluxe: "Deluxe",
  platinum: "Platinum",
} as const;
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
    plan: z.enum(["deluxe", "platinum"]),
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
    term_miles: z.number().int().min(1).max(3000000),
    claim_limit: amount.positive("Enter the aggregate repair benefit limit."),
    lender: text,
    lender_address: text,
    dealer_sold: z.literal(true, {
      error: "Confirm this vehicle was sold by Drive Max.",
    }),
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
  expires_miles: number;
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
    expires_miles: input.start_miles + input.term_miles,
    status: "active",
    terms_version: protectionVersion,
    issuer: protectionIssuer,
    claims_paid: 0,
    cancellation: null,
    revision: 1,
    created_at: new Date().toISOString(),
    created_by: "00000000-0000-4000-8000-000000000000",
  };
}
const key = { request_id: z.uuid(), id: z.uuid() };
export const protectionCommands = [
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
    mileage_used = Math.min(1, miles_used / c.term_miles),
    used = Math.max(time_used, mileage_used),
    byTime = elapsed_days * c.term_miles >= miles_used * total_days,
    denominator = byTime ? total_days : c.term_miles,
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
        (p) => p.kind === "service_contract" && p.protection_plan,
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
    product.protection_plan !== c.plan ||
    product.price !== c.price ||
    product.deductible !== c.deductible ||
    product.term_months !== c.term_months ||
    product.mileage_limit !== c.term_miles ||
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
