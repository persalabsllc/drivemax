import { z } from "zod";
import { protectionInputSchema, protectionMoney } from "./protection";
import { isMechanicalPlan, type ProtectionPlan } from "./protection-programs";
import { protectionCost, type ProductPricing } from "./protection-pricing";

export type ProtectionQuoteItem = {
  id: string;
  plan: ProtectionPlan;
  price: string;
  term_months: string;
  term_miles: string;
  unlimited_miles: boolean;
  deductible: string;
  maintenance_visits: string;
  claim_limit: string;
};
export function newProtectionQuoteItem(
  id: string,
  plan: ProtectionPlan = "deluxe",
  annualMiles = 12000,
): ProtectionQuoteItem {
  return {
    id,
    plan,
    price: "",
    term_months: plan === "appearance" ? "96" : "12",
    term_miles: String(annualMiles),
    unlimited_miles: plan === "appearance",
    deductible: "0",
    maintenance_visits: "",
    claim_limit: "",
  };
}
// Quotes can be priced before choosing the mechanical benefit limit. Issuance
// still validates every required field with protectionInputSchema.
const shape = protectionInputSchema.shape;
export const protectionQuoteProductSchema = z
  .object({
    plan: shape.plan,
    price: shape.price,
    term_months: shape.term_months,
    term_miles: shape.term_miles,
    deductible: shape.deductible,
    maintenance_visits: shape.maintenance_visits,
    claim_limit: shape.claim_limit,
  })
  .superRefine((c, ctx) => {
    if (
      (isMechanicalPlan(c.plan) && c.term_miles === null) ||
      (!isMechanicalPlan(c.plan) && c.deductible !== 0) ||
      (c.plan === "appearance" &&
        (c.term_months !== 96 || c.term_miles !== null)) ||
      (c.plan === "maintenance" &&
        (!c.maintenance_visits ||
          c.claim_limit !== c.maintenance_visits * 125)) ||
      (c.plan !== "maintenance" && c.maintenance_visits != null) ||
      (!isMechanicalPlan(c.plan) &&
        c.plan !== "maintenance" &&
        c.claim_limit !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Review the coverage and benefits for this product.",
      });
    }
  });
export type ProtectionQuoteProduct = z.infer<
  typeof protectionQuoteProductSchema
>;
export type ProtectionQuote = {
  prepared_on: string;
  holder_name: string;
  vehicle: string;
  vin: string;
  products: ProtectionQuoteProduct[];
};
export function protectionQuoteCoverage(p: ProtectionQuoteItem) {
  return {
    plan: p.plan,
    price: Number(p.price),
    term_months: Number(p.term_months),
    term_miles: p.unlimited_miles ? null : Number(p.term_miles),
    deductible: Number(p.deductible),
    maintenance_visits:
      p.plan === "maintenance" ? Number(p.maintenance_visits) : null,
    claim_limit: isMechanicalPlan(p.plan)
      ? p.claim_limit.trim()
        ? Number(p.claim_limit)
        : null
      : p.plan === "maintenance"
        ? Number(p.maintenance_visits) * 125
        : null,
  };
}
export function protectionQuoteCost(
  p: ProtectionQuoteItem,
  pricing?: ProductPricing,
) {
  const parsed = protectionQuoteProductSchema.safeParse(
    protectionQuoteCoverage(p),
  );
  if (!parsed.success || !pricing?.active || !pricing.active_revision)
    return null;
  const c = parsed.data;
  return protectionCost(
    {
      protection_plan: c.plan,
      price: c.price,
      term_months: c.term_months,
      mileage_limit: c.term_miles ?? 0,
      unlimited_miles: c.term_miles === null,
      deductible: c.deductible,
      maintenance_visits: c.maintenance_visits ?? undefined,
    },
    pricing.active,
    pricing.active_revision,
  );
}
export function protectionQuoteTotals(
  items: ProtectionQuoteItem[],
  pricing?: ProductPricing,
) {
  const coverages = items.map((p) =>
    protectionQuoteProductSchema.safeParse(protectionQuoteCoverage(p)),
  );
  const ready = items.length > 0 && coverages.every((c) => c.success);
  const allocations = items.map((p) => protectionQuoteCost(p, pricing));
  const price = ready
    ? protectionMoney(items.reduce((n, p) => n + Number(p.price), 0))
    : null;
  const cost =
    ready && allocations.every(Boolean)
      ? protectionMoney(allocations.reduce((n, c) => n + c!.cost, 0))
      : null;
  return {
    price,
    cost,
    gross:
      price !== null && cost !== null ? protectionMoney(price - cost) : null,
  };
}
