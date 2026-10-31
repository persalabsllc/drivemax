import { z } from "zod";
import type { Customer, Opportunity, Quote, Task, Workspace } from "./model";
import type { InventoryVehicle, Trade, VehicleDetails } from "./vehicles";
import { calculateQuote, type FinanceValues } from "./finance";

const amount = z.number().finite().min(0).max(1000000);
const short = z.string().trim().max(250);
export const productKinds = {
  service_contract: "Service contract",
  tire_wheel: "Tire & wheel",
  gap: "GAP",
  pdr: "Paintless dent repair",
  appearance: "Appearance protection",
  maintenance: "Prepaid maintenance",
  key_replacement: "Key replacement",
  other: "Other protection",
} as const;
export const productSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    "service_contract",
    "tire_wheel",
    "gap",
    "pdr",
    "appearance",
    "maintenance",
    "key_replacement",
    "other",
  ]),
  provider: short,
  name: z.string().trim().max(80).optional(),
  description: z.string().trim().max(400).optional(),
  contract_number: short,
  term_months: z.number().int().min(0).max(240),
  mileage_limit: z.number().int().min(0).max(3000000),
  deductible: amount,
  cost: amount.nullable(),
  price: amount,
  notes: z.string().max(2000),
});
export type FIProduct = z.infer<typeof productSchema>;
export const accountingSchema = z.object({
  vehicle_cost: amount.nullable(),
  recon: amount.nullable(),
  accessory_cost: amount,
  other_cost: amount,
  finance_reserve: amount,
  pack: amount,
  product_costs: z.record(z.uuid(), amount.nullable()).default({}),
  legacy_product_cost: amount.nullable(),
  lender: short,
  buy_rate: z.number().min(0).max(50).nullable(),
  notes: z.string().max(4000),
});
export type DealAccounting = z.infer<typeof accountingSchema>;
export const emptyAccounting: DealAccounting = {
  vehicle_cost: null,
  recon: null,
  accessory_cost: 0,
  other_cost: 0,
  finance_reserve: 0,
  pack: 0,
  product_costs: {},
  legacy_product_cost: null,
  lender: "",
  buy_rate: null,
  notes: "",
};
export const commissionSchema = z
  .object({
    id: z.uuid(),
    staff_id: z.uuid(),
    category: z.enum(["sales", "fi", "bonus"]),
    calculation: z.enum(["manual", "default"]).optional(),
    pending: z.boolean().optional(),
    amount,
    paid_amount: amount,
    paid_on: z.union([z.iso.date(), z.literal("")]),
    notes: z.string().max(1000),
  })
  .refine((c) => c.paid_amount <= c.amount && (!c.paid_amount || !!c.paid_on), {
    message:
      "Paid commission must have a payment date and cannot exceed earned commission.",
  });
export type Commission = z.infer<typeof commissionSchema> & {
  org_id: string;
  sale_id: string;
  staff_name: string;
};
export type Sale = {
  id: string;
  org_id: string;
  opportunity_id: string;
  customer_id: string;
  sold_on: string;
  created_at: string;
  status: "sold" | "unwound";
  snapshot: {
    customer: Customer;
    opportunity: Opportunity;
    quote: Quote | null;
    salesperson: { id: string; name: string } | null;
  };
  accounting: DealAccounting;
  revision: number;
  unwound_at: string | null;
  unwind_reason: string;
};
export type TradeIntake = {
  id: string;
  org_id: string;
  sale_id: string;
  opportunity_id: string;
  customer_id: string;
  stock_number: string;
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  mileage: number;
  color: string;
  cost: number;
  recon: number;
  price: number;
  acquired_on: string;
  allowance: number;
  acv: number;
  payoff: number;
  status: "received" | "retail" | "wholesale" | "wholesaled" | "returned";
  inventory_id: string | null;
  wholesale_price: number | null;
  wholesale_on: string | null;
  notes: string;
  revision: number;
};
export const tradeIntakeSchema = z
  .object({
    stock_number: short.min(1),
    year: z.number().int().min(1900).max(2100).nullable(),
    make: short,
    model: short,
    trim: short,
    mileage: z.number().int().min(0).max(3000000),
    color: short,
    cost: amount,
    recon: amount,
    price: amount,
    status: z.enum(["received", "retail", "wholesale", "wholesaled"]),
    wholesale_price: amount.nullable(),
    wholesale_on: z.union([z.iso.date(), z.literal("")]),
    notes: z.string().max(4000),
  })
  .superRefine((t, ctx) => {
    if (t.status === "retail" && (!t.year || !t.make || !t.model))
      ctx.addIssue({
        code: "custom",
        message:
          "Enter year, make, and model before moving to retail inventory.",
      });
    if (
      t.status === "wholesaled" &&
      (t.wholesale_price === null || !t.wholesale_on)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Enter wholesale proceeds and date before marking sold wholesale.",
      });
  });
export type Message = {
  id: string;
  org_id: string;
  customer_id: string;
  opportunity_id: string | null;
  task_id: string | null;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  status:
    | "draft"
    | "queued"
    | "sent"
    | "delivered"
    | "received"
    | "failed"
    | "canceled";
  recipient: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  quote_id: string | null;
  provider_id?: string | null;
  error?: string | null;
  revision: number;
};
export const operationCommands = [
  z.object({
    type: z.literal("delete_inventory"),
    id: z.uuid(),
    updated_at: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(2000),
  }),
  z.object({
    type: z.literal("delete_trade_intake"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    reason: z.string().trim().min(3).max(2000),
  }),
  z.object({
    type: z.literal("unwind_sale"),
    opportunity_id: z.uuid(),
    reason: z.string().trim().min(3).max(2000),
  }),
  z.object({
    type: z.literal("save_accounting"),
    sale_id: z.uuid(),
    revision: z.number().int().min(0),
    accounting: accountingSchema,
    commissions: z.array(commissionSchema).max(50),
  }),
  z.object({
    type: z.literal("update_trade_intake"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    trade: tradeIntakeSchema,
  }),
  z
    .object({
      type: z.literal("save_message"),
      id: z.uuid(),
      revision: z.number().int().min(0),
      customer_id: z.uuid(),
      opportunity_id: z.uuid().nullable(),
      task_id: z.uuid().nullable(),
      channel: z.enum(["sms", "email"]),
      recipient: short.min(1),
      subject: short,
      body: z.string().trim().min(1).max(16000),
      quote_id: z.uuid().nullable(),
    })
    .superRefine((m, ctx) => {
      if (
        m.channel === "email" &&
        (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.recipient) || !m.subject)
      )
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid email recipient and subject.",
        });
      if (
        m.channel === "sms" &&
        !/^\d{10,15}$/.test(m.recipient.replace(/\D/g, ""))
      )
        ctx.addIssue({
          code: "custom",
          message: "Enter a phone number with area code.",
        });
    }),
  z.object({
    type: z.literal("delete_message_draft"),
    id: z.uuid(),
    revision: z.number().int().min(0),
  }),
] as const;

export const roundMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (values: number[]) =>
  roundMoney(values.reduce((a, b) => a + b, 0));
export function productsTotal(v: FinanceValues) {
  return v.products
    ? sum(v.products.map((p) => p.price))
    : v.serviceContract || 0;
}
export const productCostFor = (s: Sale, p: FIProduct) =>
  recordedProductCost(s.accounting ?? {}, p);
const recordedProductCost = (a: Partial<DealAccounting>, p: FIProduct) =>
  Object.hasOwn(a.product_costs ?? {}, p.id)
    ? (a.product_costs![p.id] ?? null)
    : (p.cost ?? null);

/** Shared gross basis for live desking estimates and the closed-deal ledger. */
export function quoteGross(
  v: FinanceValues | undefined,
  vehicle: Pick<VehicleDetails, "cost" | "recon"> | null | undefined,
  accounting: Partial<DealAccounting> = {},
  trade: Pick<Trade, "allowance" | "acv"> | null = v
    ? { allowance: v.tradeAllowance, acv: v.acv }
    : null,
) {
  const a = { ...emptyAccounting, ...accounting };
  const cost = a.vehicle_cost ?? vehicle?.cost ?? null,
    recon = a.recon ?? vehicle?.recon ?? null;
  const allowance = trade ? (v?.tradeAllowance ?? trade.allowance) : 0;
  const acv = trade ? (v?.acv ?? trade.acv) : 0;
  const adjustment = roundMoney(acv - allowance);
  const productRevenue = v ? productsTotal(v) : 0;
  const productCost = v?.products
    ? v.products.some((p) => recordedProductCost(a, p) === null)
      ? null
      : sum(v.products.map((p) => recordedProductCost(a, p)!))
    : productRevenue
      ? a.legacy_product_cost
      : 0;
  const productGross =
    productCost === null ? null : roundMoney(productRevenue - productCost);
  const front =
    !v || cost === null || recon === null
      ? null
      : roundMoney(
          v.price -
            cost -
            recon +
            (v.addOns || 0) -
            a.accessory_cost +
            adjustment +
            v.docFee -
            a.other_cost,
        );
  const back =
    productGross === null ? null : roundMoney(productGross + a.finance_reserve);
  const gross =
    front === null || back === null ? null : roundMoney(front + back);
  return {
    cost,
    recon,
    allowance,
    acv,
    adjustment,
    productRevenue,
    productCost,
    productGross,
    front,
    back,
    gross,
    complete: !!v && gross !== null,
  };
}
export function saleMath(s: Sale, commissions: Commission[] = []) {
  const q = s.snapshot.quote,
    v = q?.values,
    a = { ...emptyAccounting, ...s.accounting },
    m = quoteGross(
      v,
      q?.vehicle_details ?? s.snapshot.opportunity?.vehicle_details,
      a,
      q?.trade_snapshot ?? s.snapshot.opportunity?.trade ?? null,
    );
  const entries = commissions.filter((c) => c.sale_id === s.id);
  const earned = s.status === "sold" ? sum(entries.map((c) => c.amount)) : 0;
  const paid = sum(entries.map((c) => c.paid_amount));
  return {
    ...m,
    earned,
    paid,
    payableFront:
      m.front === null ? null : roundMoney(m.front - (v?.docFee ?? 0) - a.pack),
    net: m.gross === null ? null : roundMoney(m.gross - earned),
    commissionBalance: roundMoney(earned - paid),
  };
}
/** Default earnings, rounded per category. Unknown costs are pending, not assumed zero. */
export function defaultCommission(
  s: Sale,
  category: Commission["category"],
): number | null {
  if (category === "bonus") return 0;
  if (!s.snapshot.quote) return null;
  const math = saleMath(s);
  const basis = category === "sales" ? math.payableFront : math.back;
  return basis === null
    ? null
    : roundMoney(Math.max(0, basis) * (category === "sales" ? 0.25 : 0.05));
}
export function calculatedCommission<
  T extends Pick<Commission, "category" | "amount" | "calculation">,
>(sale: Sale, entry: T) {
  const amount =
    entry.calculation === "default"
      ? defaultCommission(sale, entry.category)
      : entry.amount;
  return { ...entry, amount: amount ?? 0, pending: amount === null };
}
export function newDefaultCommissions(
  sale: Sale,
  staff: { id: string; name: string },
): Commission[] {
  return (["sales", "fi"] as const).map((category) =>
    calculatedCommission(sale, {
      id: crypto.randomUUID(),
      org_id: sale.org_id,
      sale_id: sale.id,
      staff_id: staff.id,
      staff_name: staff.name,
      category,
      calculation: "default" as const,
      amount: 0,
      paid_amount: 0,
      paid_on: "",
      notes: "",
    }),
  );
}
export const withinDates = (
  date: string | null | undefined,
  from: string,
  to: string,
) => !!date && (!from || date >= from) && (!to || date <= to);
export type SearchFilters = {
  query: string;
  vehicle: string;
  status: string;
  from: string;
  to: string;
  zip: string;
  radius: number;
  staff: string;
};
export type ZipPoints = Record<string, [number, number]>;
export function distanceMiles(a: [number, number], b: [number, number]) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dlat = rad(b[0] - a[0]),
    dlon = rad(b[1] - a[1]);
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dlon / 2) ** 2;
  return (
    3958.7613 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, x)), Math.sqrt(Math.max(0, 1 - x)))
  );
}
export function searchDeals(
  ws: Workspace,
  f: SearchFilters,
  points: ZipPoints = {},
) {
  const query = f.query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    vehicleTerms = f.vehicle.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const center = points[f.zip];
  return ws.customers
    .flatMap((c) => {
      const aliases = (ws.customer_aliases ?? []).filter(
        (a) => a.customer_id === c.id,
      );
      const ops = ws.opportunities.filter((o) => o.customer_id === c.id);
      return (ops.length ? ops : [null]).flatMap((o) => {
        const snapshot = o?.sale_snapshot?.customer ?? c;
        const v =
          o?.sale_snapshot?.quote?.vehicle_details ??
          (o?.status === "sold" || o?.status === "lost"
            ? o.vehicle_details
            : (ws.inventory.find((i) => i.id === o?.inventory_id) ??
              o?.vehicle_details));
        const zip = (snapshot.person?.zip ?? c.person?.zip ?? "").slice(0, 5);
        const miles =
          center && points[zip] ? distanceMiles(center, points[zip]) : null;
        if (
          f.status !== "all" &&
          (f.status === "active"
            ? !o || ["sold", "lost"].includes(o.status)
            : f.status === "none"
              ? !!o
              : o?.status !== f.status)
        )
          return [];
        if ((f.from || f.to) && (!o || !withinDates(o.sold_on, f.from, f.to)))
          return [];
        if (f.staff && o?.assigned_to !== f.staff) return [];
        if (
          f.zip &&
          (f.radius ? miles === null || miles > f.radius : zip !== f.zip)
        )
          return [];
        const vehicleText = [
          o?.vehicle_interest,
          o?.sale_snapshot?.quote?.vehicle,
          v?.year,
          v?.make,
          v?.model,
          v?.trim,
          v?.vin,
          v?.stock_number,
        ]
          .join(" ")
          .toLowerCase();
        const all = [
          c.name,
          c.email,
          c.phone,
          ...aliases.flatMap((a) => [a.name, a.phone, a.email]),
          snapshot.name,
          o?.title,
          zip,
          vehicleText,
        ]
          .join(" ")
          .toLowerCase();
        if (
          !query.every(
            (t) =>
              all.includes(t) ||
              (/^[+()\d.\-]+$/.test(t) &&
                t.replace(/\D/g, "").length >= 3 &&
                [c.phone, ...aliases.map((a) => a.phone)].some((phone) =>
                  phone.replace(/\D/g, "").includes(t.replace(/\D/g, "")),
                )),
          ) ||
          !vehicleTerms.every((t) => vehicleText.includes(t))
        )
          return [];
        return [{ customer: c, opportunity: o, vehicle: v, zip, miles }];
      });
    })
    .sort((a, b) =>
      (
        b.opportunity?.sold_on ??
        b.opportunity?.updated_at ??
        b.customer.updated_at
      ).localeCompare(
        a.opportunity?.sold_on ??
          a.opportunity?.updated_at ??
          a.customer.updated_at,
      ),
    );
}
/** Filter opportunities first, then collapse to one profile before pagination. */
export function searchCustomers(
  ws: Workspace,
  f: SearchFilters,
  points: ZipPoints = {},
) {
  const seen = new Set<string>();
  return searchDeals(ws, f, points).filter(({ customer }) => {
    if (seen.has(customer.id)) return false;
    seen.add(customer.id);
    return true;
  });
}
export const taskChannel = (t: Task): "call" | "email" | "sms" | "task" =>
  t.channel ??
  (/text|sms/i.test(t.title)
    ? "sms"
    : /email|e-mail/i.test(t.title)
      ? "email"
      : "call");
export function quoteMessage(q: Quote, c: Customer) {
  const m = calculateQuote(q.values);
  return `Hi ${c.person?.first_name || c.name.split(" ")[0]}, here is your Drive Max quote for ${q.vehicle}.\n\nVehicle price: $${q.values.price.toFixed(2)}\nDoc fee: $${q.values.docFee.toFixed(2)}${q.values.showProtectionProducts !== false ? `\nProtection products: $${productsTotal(q.values).toFixed(2)}` : ""}\nEstimated total: $${m.total.toFixed(2)}\nDown payment: $${q.values.downPayment.toFixed(2)}\nEstimated balance: $${m.balance.toFixed(2)}${q.values.mode === "cash" ? "" : `\nEstimated payment: $${m.payment.toFixed(2)} for ${q.values.months} months${q.values.showAPR !== false ? ` at ${q.values.apr}% APR` : ""}.`}\n\nEstimate only, subject to lender approval and final paperwork.`;
}
export function csvText(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          let s = String(v ?? "");
          if (/^[=+@\-\t\r]/.test(s) && typeof v !== "number") s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
