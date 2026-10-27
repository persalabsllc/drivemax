import { z } from "zod";
import type { Opportunity, Workspace } from "./model";
import { vehicleName, vinSchema } from "./vehicles";

const text = z.string().trim().max(250);
const amount = z.number().finite().min(0).max(1000000);
const optionalAmount = amount.nullable();
export const appraisalVehicleSchema = z.object({
  vin: z.union([vinSchema, z.literal("")]),
  year: z.number().int().min(1900).max(2100),
  make: text.min(1, "Enter the vehicle make"),
  model: text.min(1, "Enter the vehicle model"),
  trim: text,
  mileage: z.number().int().min(0).max(3000000).nullable(),
});
export function safeResearchUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    // Provider credentials must never be persisted in or rendered as a link.
    if (
      [...url.searchParams.keys()].some((k) =>
        /key|token|secret|password/i.test(k),
      )
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}
const url = z
  .string()
  .trim()
  .max(1500)
  .refine(
    (v) => !v || !!safeResearchUrl(v),
    "Use a public http or https listing URL without credentials",
  );
export const bookValueSchema = z
  .object({
    id: z.uuid(),
    source: text.min(1),
    basis: z.enum(["trade", "private", "retail", "wholesale"]),
    low: optionalAmount,
    high: optionalAmount,
    date: z.iso.date(),
    condition: text,
    url,
  })
  .refine(
    (v) => v.low === null || v.high === null || v.low <= v.high,
    "Book range: low must not exceed high",
  )
  .refine(
    (v) => v.low !== null || v.high !== null,
    "Enter at least one book value",
  );
export const comparableSchema = z.object({
  id: z.uuid(),
  vehicle: text.min(1),
  vin: z.union([vinSchema, z.literal("")]),
  mileage: z.number().int().min(0).max(3000000).nullable(),
  price: amount.positive("Enter a comparable price greater than zero"),
  basis: z.enum(["retail_asking", "private_asking", "sold", "wholesale"]),
  source: text.min(1),
  url,
  date: z.iso.date(),
  included: z.boolean(),
  notes: z.string().trim().max(500),
});
export const appraisalDataSchema = z.object({
  vehicle: appraisalVehicleSchema,
  description: text,
  zip: z.string().regex(/^\d{5}$/, "Enter a five-digit ZIP code"),
  radius: z.number().int().min(10).max(500),
  condition: z.enum(["uninspected", "excellent", "good", "fair", "poor"]),
  title: z.enum(["unverified", "clean", "branded", "salvage"]),
  inspection_notes: z.string().trim().max(4000),
  disposition: z.enum(["retail", "wholesale"]),
  target_value: optionalAmount,
  target_profit: amount,
  proposed_acv: optionalAmount,
  recon: z
    .array(z.object({ id: z.uuid(), label: text.min(1), amount }))
    .max(30),
  buyer_fee: amount,
  transport: amount,
  other_cost: amount,
  books: z.array(bookValueSchema).max(20),
  comparables: z.array(comparableSchema).max(30),
  notes: z.string().trim().max(4000),
});
export type AppraisalData = z.infer<typeof appraisalDataSchema>;
export type AppraisalVehicle = z.infer<typeof appraisalVehicleSchema>;
export type Comparable = z.infer<typeof comparableSchema>;
export type Appraisal = {
  id: string;
  org_id: string;
  opportunity_id: string | null;
  source: "trade" | "street" | "auction" | "other";
  status: "draft" | "review" | "valued" | "archived";
  data: AppraisalData;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  reviewed_name: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
};
const existing = { id: z.uuid(), revision: z.number().int().min(1) };
export const appraisalCommands = [
  z.object({
    type: z.literal("save_appraisal"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    opportunity_id: z.uuid().nullable(),
    source: z.enum(["trade", "street", "auction", "other"]),
    status: z.enum(["draft", "review"]),
    data: appraisalDataSchema,
  }),
  z.object({ type: z.literal("approve_appraisal"), ...existing }),
  z.object({
    type: z.literal("apply_appraisal"),
    ...existing,
    opportunity_updated_at: z.string().datetime({ offset: true }),
  }),
  z.object({ type: z.literal("archive_appraisal"), ...existing }),
] as const;
export type AppraisalCommand = z.infer<(typeof appraisalCommands)[number]>;
export function newAppraisalData(o?: Opportunity): AppraisalData {
  const t = o?.trade;
  return {
    vehicle: {
      vin: t?.vin || "",
      year: t?.year || 0,
      make: t?.make || "",
      model: t?.model || "",
      trim: t?.trim || "",
      mileage: t?.mileage ?? null,
    },
    description: o?.trade_vehicle || "",
    zip: "28562",
    radius: 100,
    condition: "uninspected",
    title: "unverified",
    inspection_notes: "",
    disposition: "retail",
    target_value: null,
    target_profit: 2000,
    proposed_acv: t?.acv || null,
    recon: [],
    buyer_fee: 0,
    transport: 0,
    other_cost: 0,
    books: [],
    comparables: [],
    notes: "",
  };
}
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function appraisalMath(d: AppraisalData) {
  const recon = cents(d.recon.reduce((n, r) => n + r.amount, 0));
  const expenses = cents(recon + d.buyer_fee + d.transport + d.other_cost);
  return {
    recon,
    expenses,
    maxBuy:
      d.target_value === null
        ? null
        : cents(d.target_value - expenses - d.target_profit),
    invested: d.proposed_acv === null ? null : cents(d.proposed_acv + expenses),
    projectedProfit:
      d.target_value === null || d.proposed_acv === null
        ? null
        : cents(d.target_value - d.proposed_acv - expenses),
  };
}
export function comparableSummary(
  rows: Comparable[],
  basis: Comparable["basis"] = "retail_asking",
) {
  const prices = rows
    .filter((r) => r.included && r.basis === basis && r.price > 0)
    .map((r) => r.price)
    .sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length
    ? {
        count: prices.length,
        low: prices[0],
        high: prices.at(-1)!,
        median: cents(
          prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
        ),
      }
    : null;
}
export function tradeMatchesAppraisal(o: Opportunity, d: AppraisalData) {
  const t = o.trade,
    v = d.vehicle;
  return (
    !!t &&
    !!v.vin &&
    t.vin.toUpperCase() === v.vin.toUpperCase() &&
    t.mileage === v.mileage &&
    t.year === v.year &&
    t.make.toLowerCase().trim() === v.make.toLowerCase().trim() &&
    t.model.toLowerCase().trim() === v.model.toLowerCase().trim() &&
    t.trim.toLowerCase().trim() === v.trim.toLowerCase().trim()
  );
}
export type AppraisalEntry = {
  id: string;
  appraisal?: Appraisal;
  opportunity?: Opportunity;
  customerName: string;
  vehicle: string;
  history: boolean;
  source: Appraisal["source"];
};
export function appraisalEntries(ws: Workspace): AppraisalEntry[] {
  const appraisals = ws.appraisals || [];
  const rows: AppraisalEntry[] = ws.opportunities
    .filter((o) => !!o.trade || !!o.trade_vehicle.trim())
    .map((o) => {
      const appraisal = appraisals.find((a) => a.opportunity_id === o.id);
      return {
        id: o.id,
        appraisal,
        opportunity: o,
        customerName:
          ws.customers.find((c) => c.id === o.customer_id)?.name || "Customer",
        vehicle: o.trade
          ? vehicleName(o.trade) || o.trade_vehicle
          : o.trade_vehicle,
        history: ["sold", "lost"].includes(o.status),
        source: "trade",
      };
    });
  // Keep saved research even if the trade has since been removed from its deal.
  for (const a of appraisals)
    if (!rows.some((r) => r.appraisal?.id === a.id)) {
      const o = ws.opportunities.find((o) => o.id === a.opportunity_id);
      rows.push({
        id: a.id,
        appraisal: a,
        opportunity: o,
        customerName: o
          ? ws.customers.find((c) => c.id === o.customer_id)?.name || "Customer"
          : "Standalone valuation",
        vehicle: vehicleName(a.data.vehicle),
        history: !!a.opportunity_id,
        source: a.source,
      });
    }
  return rows.sort(
    (a, b) =>
      Number(a.history) - Number(b.history) ||
      (
        b.appraisal?.updated_at ||
        b.opportunity?.updated_at ||
        ""
      ).localeCompare(
        a.appraisal?.updated_at || a.opportunity?.updated_at || "",
      ),
  );
}
export function driveMaxComparables(
  ws: Workspace,
  v: AppraisalVehicle,
): Comparable[] {
  const match = (
    x:
      | (Omit<Partial<AppraisalVehicle>, "year"> & { year?: number | null })
      | null
      | undefined,
  ) =>
    !!x &&
    !!v.make &&
    !!v.model &&
    x.make?.toLowerCase().trim() === v.make.toLowerCase().trim() &&
    x.model?.toLowerCase().trim() === v.model.toLowerCase().trim() &&
    !!x.year &&
    Math.abs(x.year - v.year) <= 3;
  const sold: Comparable[] = (ws.sales || [])
    .filter((s) => s.status === "sold")
    .flatMap((s) => {
      const q = s.snapshot?.quote,
        car = q?.vehicle_details || s.snapshot?.opportunity?.vehicle_details;
      if (!q || !match(car)) return [];
      return [
        {
          id: s.id,
          vehicle: vehicleName(car!),
          vin: car!.vin || "",
          mileage: car!.mileage ?? null,
          price: q.values.price,
          basis: "sold" as const,
          source: "Drive Max · completed sale",
          url: "",
          date: s.sold_on,
          included: true,
          notes: `Stock ${car!.stock_number || "—"}. Actual vehicle selling price; excludes fees, tax and F&I.`,
        },
      ];
    });
  const inventory: Comparable[] = ws.inventory
    .filter(
      (i) =>
        ["in_stock", "pending"].includes(i.status) &&
        match(i) &&
        (!v.vin || i.vin !== v.vin),
    )
    .map((i) => ({
      id: i.id,
      vehicle: vehicleName(i),
      vin: i.vin,
      mileage: i.mileage,
      price: i.price,
      basis: "retail_asking",
      source: "Drive Max · current inventory",
      url: "",
      date: i.updated_at.slice(0, 10),
      included: true,
      notes: `Stock ${i.stock_number}. Advertised vehicle price, not a completed sale.`,
    }));
  return [...sold, ...inventory].sort((a, b) => b.date.localeCompare(a.date));
}
export const basisLabels = {
  trade: "Trade-in",
  private: "Private party",
  retail: "Retail",
  wholesale: "Wholesale",
};
export const compLabels = {
  retail_asking: "Retail asking",
  private_asking: "Private asking",
  sold: "Confirmed sale",
  wholesale: "Wholesale",
};
export const sourceLabels = {
  trade: "Customer trade",
  street: "Street purchase",
  auction: "Auction buy",
  other: "Other purchase",
};
