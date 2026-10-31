import { z } from "zod";
import {
  isMechanicalPlan,
  protectionPlanIds,
  type ProtectionPlan,
} from "./protection-programs";
import type { FIProduct } from "./operations";
import type { Command, Workspace } from "./model";

const money = z.number().finite().min(0).max(1000000).multipleOf(0.01);
const rate = z.object({
  basis: z.enum(["annual", "annual_mileage", "first_limit", "visit", "flat"]),
  amount: money,
});
export const pricingConfigSchema = z
  .object({
    rates: z.object({
      deluxe: rate,
      platinum: rate,
      maintenance: rate,
      tire_wheel: rate,
      pdr: rate,
      appearance: rate,
      key_replacement: rate,
    }),
    annual_miles: z.number().int().min(1000).max(100000),
    maintenance_interval: z.number().int().min(1000).max(20000),
    reserve_percent: z.number().finite().min(0).max(100).multipleOf(0.01),
    account_name: z.string().trim().min(1).max(100),
    // Optional for saved legacy schedules and immutable contract snapshots.
    deductible_discounts: z
      .object({
        "0": z.literal(0),
        "250": z.number().finite().min(0).max(95).multipleOf(0.01),
        "500": z.number().finite().min(0).max(95).multipleOf(0.01),
        "1000": z.number().finite().min(0).max(95).multipleOf(0.01),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    const discounts = c.deductible_discounts;
    if (
      discounts &&
      (discounts[250] > discounts[500] || discounts[500] > discounts[1000])
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Discounts must stay the same or increase with the deductible.",
      });
    for (const plan of protectionPlanIds) {
      const allowed =
        plan === "maintenance"
          ? ["visit"]
          : plan === "appearance"
            ? ["flat"]
            : isMechanicalPlan(plan)
              ? ["annual", "annual_mileage", "first_limit"]
              : ["annual", "annual_mileage"];
      if (!allowed.includes(c.rates[plan].basis))
        ctx.addIssue({
          code: "custom",
          message: "Review the product pricing basis.",
        });
    }
  });
export type PricingConfig = z.infer<typeof pricingConfigSchema>;
// Defaults for a new schedule. Saving and activating remain separate actions.
export const proposedPricing: PricingConfig = {
  rates: {
    deluxe: { basis: "first_limit", amount: 399 },
    platinum: { basis: "first_limit", amount: 599 },
    maintenance: { basis: "visit", amount: 125 },
    tire_wheel: { basis: "annual", amount: 87 },
    pdr: { basis: "annual", amount: 65 },
    appearance: { basis: "flat", amount: 199 },
    key_replacement: { basis: "annual", amount: 75 },
  },
  annual_miles: 12000,
  maintenance_interval: 5000,
  reserve_percent: 40,
  account_name: "Drive Max Protection Claims Fund",
  deductible_discounts: { "0": 0, "250": 10, "500": 20, "1000": 35 },
};
export const pricingSnapshotSchema = z.object({
  revision: z.number().int().positive(),
  plan: z.enum(protectionPlanIds),
  basis: rate.shape.basis,
  rate: money,
  units: z.number().finite().nonnegative(),
  scheduled_cost: money,
  reserve_floor: money,
  cost: money,
  base_cost: money.optional(),
  deductible: z.number().nonnegative().optional(),
  deductible_discount_percent: z.number().min(0).max(95).optional(),
});
export type PricingSnapshot = z.infer<typeof pricingSnapshotSchema>;
export type ProductPricing = {
  id: string;
  org_id: string;
  draft: PricingConfig;
  active: PricingConfig | null;
  revision: number;
  active_revision: number | null;
  updated_at: string;
  updated_by: string;
  issued_costs?: Record<
    string,
    { cost: number | null; pricing_snapshot?: PricingSnapshot | null }
  >;
};
export type PricingEvent = {
  id: string;
  org_id: string;
  command: Record<string, unknown>;
  created_by: string;
  created_at: string;
};
export type FundEntry = {
  id: string;
  org_id: string;
  direction: "in" | "out";
  amount: number;
  posted_on: string;
  reference: string;
  notes: string;
  contract_id: string | null;
  reversal_of: string | null;
  created_by: string;
  created_at: string;
};
export type CostCoverage = {
  protection_plan?: ProtectionPlan;
  term_months: number;
  mileage_limit: number;
  unlimited_miles?: boolean;
  maintenance_visits?: number;
  deductible?: number;
  price: number;
};
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function protectionCost(
  p: CostCoverage,
  config: PricingConfig,
  revision: number,
): PricingSnapshot | null {
  if (
    !p.protection_plan ||
    !Number.isInteger(p.term_months) ||
    p.term_months <= 0 ||
    !Number.isFinite(p.price)
  )
    return null;
  const r = config.rates[p.protection_plan];
  if (r.basis === "visit" && !p.maintenance_visits) return null;
  const usesMileage = r.basis === "annual_mileage" || r.basis === "first_limit";
  if (
    usesMileage &&
    !p.unlimited_miles &&
    (!Number.isInteger(p.mileage_limit) || p.mileage_limit <= 0)
  )
    return null;
  const mileageRated =
    usesMileage &&
    !p.unlimited_miles &&
    (r.basis === "first_limit"
      ? p.mileage_limit * 12 < p.term_months * config.annual_miles
      : p.mileage_limit * 12 > p.term_months * config.annual_miles);
  const numerator =
    r.basis === "flat"
      ? 1
      : r.basis === "visit"
        ? p.maintenance_visits!
        : mileageRated
          ? p.mileage_limit
          : p.term_months;
  const denominator =
    r.basis === "flat" || r.basis === "visit"
      ? 1
      : mileageRated
        ? config.annual_miles
        : 12;
  const units = numerator / denominator;
  const discounts = isMechanicalPlan(p.protection_plan)
    ? config.deductible_discounts
    : undefined;
  const deductible = p.deductible ?? 0;
  if (discounts && ![0, 250, 500, 1000].includes(deductible)) return null;
  const discount = discounts?.[deductible as 0 | 250 | 500 | 1000] ?? 0;
  if (!Number.isInteger(numerator) || numerator <= 0) return null;
  // Round once, after term/mileage proration and the deductible discount.
  // Integer arithmetic matches PostgreSQL numeric even at half-cent boundaries.
  const prorated = (percent: number) => {
    const divisor = BigInt(denominator) * 10000n;
    const value =
      BigInt(Math.round(r.amount * 100)) *
      BigInt(numerator) *
      BigInt(10000 - Math.round(percent * 100));
    return Number((value + divisor / 2n) / divisor) / 100;
  };
  const scheduled_cost = prorated(discount);
  const reserve_floor =
    Math.round(
      (Math.round(p.price * 100) * Math.round(config.reserve_percent * 100)) /
        10000,
    ) / 100;
  return {
    revision,
    plan: p.protection_plan,
    basis: r.basis,
    rate: r.amount,
    units: Math.round(units * 1000000) / 1000000,
    scheduled_cost,
    reserve_floor,
    cost: Math.max(scheduled_cost, reserve_floor),
    ...(discounts
      ? {
          base_cost: prorated(0),
          deductible,
          deductible_discount_percent: discount,
        }
      : {}),
  };
}
export function priceProduct(
  p: FIProduct,
  pricing?: ProductPricing,
): FIProduct {
  const issued = pricing?.issued_costs?.[p.id];
  if (issued)
    return {
      ...p,
      cost: issued.cost,
      pricing_snapshot: issued.pricing_snapshot ?? undefined,
    };
  if (!pricing?.active || !pricing.active_revision || !p.protection_plan)
    return p;
  const snapshot = protectionCost(p, pricing.active, pricing.active_revision);
  return {
    ...p,
    cost: snapshot?.cost ?? null,
    pricing_snapshot: snapshot ?? undefined,
  };
}
export function validatePricedValues(
  values: { products?: FIProduct[]; fiMenu?: { products: FIProduct[] } },
  pricing?: ProductPricing,
) {
  if (!pricing?.active) return;
  for (const p of [
    ...(values.products ?? []),
    ...(values.fiMenu?.products ?? []),
  ]) {
    if (!p.protection_plan) continue;
    const expected = priceProduct(p, pricing);
    if (
      (!pricing.issued_costs?.[p.id] && expected.cost === null) ||
      p.cost !== expected.cost ||
      JSON.stringify(p.pricing_snapshot) !==
        JSON.stringify(expected.pricing_snapshot)
    )
      throw Error(
        "Product pricing changed. Reopen the product selector and save the updated costs.",
      );
  }
}
export function pricingForDeal(
  ws: Pick<Workspace, "product_pricing" | "protection_contracts" | "quotes">,
  opportunityId?: string,
): ProductPricing | undefined {
  const pricing = ws.product_pricing?.[0];
  if (!pricing || !opportunityId) return pricing;
  return {
    ...pricing,
    issued_costs: Object.fromEntries(
      (ws.protection_contracts ?? [])
        .filter((c) => c.opportunity_id === opportunityId && c.product_id)
        .map((c) => {
          const source = ws.quotes
            .find((q) => q.id === c.quote_id)
            ?.values.products?.find((p) => p.id === c.product_id);
          return [
            c.product_id!,
            {
              cost: c.internal_cost ?? source?.cost ?? null,
              pricing_snapshot: c.pricing_snapshot ?? source?.pricing_snapshot,
            },
          ];
        }),
    ),
  };
}
export const pricingErrors = [
  "Product pricing changed. Reopen the product selector and save the updated costs.",
  "Pricing settings changed. Refresh and review the current draft.",
  "Owner approval is required to activate product pricing.",
  "Review the product pricing settings.",
  "Fund entry unavailable.",
  "This fund entry has already been reversed.",
  "Enter a valid fund transaction.",
];
export const pricingCommands = [
  z.object({
    type: z.literal("save_product_pricing"),
    request_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    config: pricingConfigSchema,
  }),
  z.object({
    type: z.literal("activate_product_pricing"),
    request_id: z.uuid(),
    revision: z.number().int().positive(),
    approved: z.literal(true),
  }),
  z.object({
    type: z.literal("pause_product_pricing"),
    request_id: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("record_protection_fund"),
    request_id: z.uuid(),
    direction: z.enum(["in", "out"]),
    amount: money.positive(),
    posted_on: z.iso.date(),
    reference: z.string().trim().min(1).max(150),
    notes: z.string().trim().max(1000),
    contract_id: z.uuid().nullable(),
  }),
  z.object({
    type: z.literal("reverse_protection_fund"),
    request_id: z.uuid(),
    id: z.uuid(),
    posted_on: z.iso.date(),
    reason: z.string().trim().min(3).max(1000),
  }),
] as const;
type PricingCommand = z.infer<(typeof pricingCommands)[number]>;
export function demoPricing(
  ws: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (!pricingCommands.some((s) => s.shape.type.value === command.type))
    return null;
  const p = command as PricingCommand;
  if (!["owner", "manager"].includes(ws.member.role))
    throw Error("Manager access required");
  const prior = ws.pricing_events?.find((e) => e.id === p.request_id);
  if (prior) {
    if (
      prior.created_by !== ws.member.id ||
      JSON.stringify(prior.command) !== JSON.stringify(p)
    )
      throw Error("Use a new request key for changed details.");
    return ws;
  }
  const s = structuredClone(ws),
    stamp = now.toISOString();
  s.product_pricing ??= [];
  s.pricing_events ??= [];
  s.protection_fund_entries ??= [];
  const current = s.product_pricing[0];
  if ("revision" in p) {
    if ((current?.revision ?? 0) !== p.revision) throw Error(pricingErrors[1]);
    if (p.type === "save_product_pricing") {
      s.product_pricing = [
        {
          id: s.org.id,
          org_id: s.org.id,
          draft: p.config,
          active: current?.active ?? null,
          active_revision: current?.active_revision ?? null,
          revision: p.revision + 1,
          updated_at: stamp,
          updated_by: s.member.id,
        },
      ];
    } else {
      if (s.member.role !== "owner" || !current) throw Error(pricingErrors[2]);
      current.revision++;
      current.active =
        p.type === "activate_product_pricing"
          ? structuredClone(current.draft)
          : null;
      current.active_revision = current.active ? current.revision : null;
      current.updated_at = stamp;
      current.updated_by = s.member.id;
    }
  } else {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(now);
    if (p.posted_on > today) throw Error(pricingErrors[6]);
    if (p.type === "record_protection_fund") {
      if (
        p.contract_id &&
        !s.protection_contracts?.some((c) => c.id === p.contract_id)
      )
        throw Error(pricingErrors[4]);
      s.protection_fund_entries.unshift({
        ...p,
        id: p.request_id,
        org_id: s.org.id,
        reversal_of: null,
        created_by: s.member.id,
        created_at: stamp,
      });
    } else {
      const entry = s.protection_fund_entries.find((e) => e.id === p.id);
      if (!entry || entry.reversal_of) throw Error(pricingErrors[4]);
      if (s.protection_fund_entries.some((e) => e.reversal_of === entry.id))
        throw Error(pricingErrors[5]);
      if (p.posted_on < entry.posted_on) throw Error(pricingErrors[6]);
      s.protection_fund_entries.unshift({
        ...entry,
        id: p.request_id,
        direction: entry.direction === "in" ? "out" : "in",
        posted_on: p.posted_on,
        reference: "Reversal: " + entry.reference,
        notes: p.reason,
        reversal_of: entry.id,
        created_by: s.member.id,
        created_at: stamp,
      });
    }
  }
  s.pricing_events.unshift({
    id: p.request_id,
    org_id: s.org.id,
    command: p,
    created_by: s.member.id,
    created_at: stamp,
  });
  return s;
}
export function protectionFund(ws: Workspace) {
  const rows = (ws.protection_contracts ?? []).map((c) => ({
    contract: c,
    target:
      c.status === "canceled"
        ? c.cancellation?.paid_on
          ? 0
          : (c.cancellation?.refund ?? 0)
        : c.internal_cost == null
          ? null
          : Math.max(0, cents(c.internal_cost - c.claims_paid)),
  }));
  const balance = cents(
    (ws.protection_fund_entries ?? []).reduce(
      (n, e) => n + (e.direction === "in" ? e.amount : -e.amount),
      0,
    ),
  );
  const target = cents(rows.reduce((n, r) => n + (r.target ?? 0), 0));
  return {
    rows,
    balance,
    target,
    shortfall: Math.max(0, cents(target - balance)),
    unknown: rows.filter((r) => r.target === null).length,
  };
}
