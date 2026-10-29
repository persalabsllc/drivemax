import { z } from "zod";
import type { Workspace } from "./model";
import type { Sale } from "./operations";
import { saleMath } from "./operations";
import { calculateQuote } from "./finance";

const money = z
  .number()
  .finite()
  .min(0)
  .max(1000000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
    "Use dollars and cents.",
  );
const date = z.iso.date();
const short = z.string().trim().max(250);
const notes = z.string().trim().max(2000);
export const paymentMethods = [
  "ACH",
  "Check",
  "Cash",
  "Card",
  "Wire",
  "Other",
] as const;
export const moneyPlanSchema = z.object({
  expected_lender: money,
  expected_customer: money,
  lender: short,
  lender_due: date.nullable(),
  customer_due: date.nullable(),
  notes,
});
export type MoneyPlanValues = z.infer<typeof moneyPlanSchema>;
export type MoneyPlan = MoneyPlanValues & {
  id: string;
  org_id: string;
  revision: number;
  updated_at: string;
  updated_by: string;
};
export type MoneyEntry = {
  id: string;
  org_id: string;
  sale_id: string;
  kind: "lender" | "customer";
  amount: number;
  received_on: string;
  method: string;
  reference: string;
  notes: string;
  reversal_of: string | null;
  created_at: string;
  created_by: string;
};
export const adSpendSchema = z.object({
  spent_on: date,
  source: z.string().trim().min(1).max(80),
  amount: money,
  campaign: short,
  notes,
});
export type AdSpend = z.infer<typeof adSpendSchema> & {
  id: string;
  org_id: string;
  revision: number;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
  updated_at: string;
};
export type BusinessEvent = {
  id: string;
  org_id: string;
  subject_id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  created_by: string;
};
const request = { request_id: z.uuid() };
export const businessCommands = [
  z.object({
    type: z.literal("save_money_plan"),
    ...request,
    sale_id: z.uuid(),
    revision: z.number().int().min(0),
    plan: moneyPlanSchema,
  }),
  z.object({
    type: z.literal("record_money"),
    ...request,
    id: z.uuid(),
    sale_id: z.uuid(),
    revision: z.number().int().min(1),
    kind: z.enum(["lender", "customer"]),
    amount: money.refine((v) => v > 0, "Enter an amount greater than zero."),
    received_on: date,
    method: z.enum(paymentMethods),
    reference: short,
    notes,
  }),
  z.object({
    type: z.literal("reverse_money"),
    ...request,
    id: z.uuid(),
    sale_id: z.uuid(),
    revision: z.number().int().min(1),
    original_id: z.uuid(),
    received_on: date,
    reason: notes.min(3),
  }),
  z.object({
    type: z.literal("save_ad_spend"),
    ...request,
    id: z.uuid(),
    revision: z.number().int().min(0),
    spend: adSpendSchema,
  }),
  z.object({
    type: z.literal("void_ad_spend"),
    ...request,
    id: z.uuid(),
    revision: z.number().int().min(1),
    reason: notes.min(3),
  }),
] as const;
export type BusinessCommand = z.infer<(typeof businessCommands)[number]>;
export const businessErrors = [
  "Money records changed. Refresh before saving.",
  "Review the expected amounts before recording receipts.",
  "Only sold deals can be updated in Money owed.",
  "This receipt has already been reversed.",
  "Receipt unavailable.",
  "Use a new request key for changed details.",
  "Advertising entry changed. Refresh before saving.",
  "This advertising entry was voided.",
  "Receipt and spending dates cannot be in the future.",
  "Check the expected amounts and payment details.",
  "Manager access required",
];
export const cents = (n: number) => Math.round(n * 100);
export const dollars = (n: number) => n / 100;
export function suggestedMoneyPlan(
  sale: Sale,
  ws: Workspace,
): Partial<MoneyPlanValues> {
  const q = sale.snapshot?.quote?.values,
    progress = ws.deal_progress?.find((p) => p.id === sale.opportunity_id);
  const base = {
    lender: progress?.lender || sale.accounting?.lender || "",
    lender_due: null,
    customer_due: null,
    notes: "",
  };
  if (!q) return base;
  const calc = calculateQuote(q);
  return {
    ...base,
    expected_lender: q.mode === "cash" ? 0 : Math.max(0, calc.balance),
    expected_customer: Math.max(
      0,
      q.mode === "cash" ? calc.total : q.downPayment,
    ),
  };
}
export function receivableRows(ws: Workspace, today: string) {
  return (ws.sales ?? [])
    .map((sale) => {
      const plan = ws.money_plans?.find((p) => p.id === sale.id);
      const entries = (ws.money_entries ?? []).filter(
        (e) => e.sale_id === sale.id,
      );
      const received = (kind: MoneyEntry["kind"]) =>
        dollars(
          entries
            .filter((e) => e.kind === kind)
            .reduce(
              (n, e) => n + (e.reversal_of ? -1 : 1) * cents(e.amount),
              0,
            ),
        );
      const lenderReceived = received("lender"),
        customerReceived = received("customer");
      const lenderBalance = plan
        ? dollars(cents(plan.expected_lender) - cents(lenderReceived))
        : null;
      const customerBalance = plan
        ? dollars(cents(plan.expected_customer) - cents(customerReceived))
        : null;
      const due = plan
        ? dollars(
            Math.max(0, cents(lenderBalance!)) +
              Math.max(0, cents(customerBalance!)),
          )
        : null;
      const overpayment = plan
        ? dollars(
            Math.max(0, -cents(lenderBalance!)) +
              Math.max(0, -cents(customerBalance!)),
          )
        : 0;
      return {
        sale,
        plan,
        entries,
        lenderReceived,
        customerReceived,
        lenderBalance,
        customerBalance,
        due,
        overpayment,
        age: Math.max(
          0,
          Math.floor(
            (Date.parse(today + "T12:00:00Z") -
              Date.parse(sale.sold_on + "T12:00:00Z")) /
              86400000,
          ),
        ),
        overdue:
          !!plan &&
          ((lenderBalance! > 0 &&
            !!plan.lender_due &&
            plan.lender_due < today) ||
            (customerBalance! > 0 &&
              !!plan.customer_due &&
              plan.customer_due < today)),
        stage: ws.deal_progress?.find((p) => p.id === sale.opportunity_id),
      };
    })
    .sort((a, b) => b.age - a.age || a.sale.id.localeCompare(b.sale.id));
}
export const sourceKey = (v: string) =>
  v.trim().replace(/\s+/g, " ").toLowerCase() || "unknown";
export function advertisingReport(ws: Workspace, from: string, to: string) {
  const localDay = (value: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const opportunities = ws.opportunities.filter(
    (o) => localDay(o.created_at) >= from && localDay(o.created_at) <= to,
  );
  const spends = (ws.ad_spend ?? []).filter(
    (e) => !e.voided_at && e.spent_on >= from && e.spent_on <= to,
  );
  const names = new Map<string, string>();
  for (const o of opportunities)
    names.set(sourceKey(o.source), o.source.trim() || "Unknown");
  for (const e of spends) names.set(sourceKey(e.source), e.source.trim());
  return [...names]
    .map(([key, name]) => {
      const leads = opportunities.filter((o) => sourceKey(o.source) === key),
        ids = new Set(leads.map((o) => o.id));
      const sales = (ws.sales ?? []).filter(
        (s) => s.status === "sold" && ids.has(s.opportunity_id),
      );
      const unrecordedSales = leads.filter(
        (o) =>
          o.status === "sold" && !sales.some((s) => s.opportunity_id === o.id),
      ).length;
      const math = sales.map((s) => saleMath(s, ws.commissions));
      const missingGross =
        math.filter((m) => m.gross === null).length + unrecordedSales;
      const completeGross = dollars(
        math.reduce((n, m) => n + cents(m.gross ?? 0), 0),
      );
      const entries = spends.filter((e) => sourceKey(e.source) === key);
      const spend = entries.length
        ? dollars(entries.reduce((n, e) => n + cents(e.amount), 0))
        : null;
      const sold = sales.length + unrecordedSales;
      const gross = missingGross ? null : completeGross;
      return {
        key,
        name,
        leads: leads.length,
        sold,
        spend,
        gross,
        completeGross,
        missingGross,
        entries,
        costPerLead:
          spend !== null && leads.length ? spend / leads.length : null,
        costPerSale: spend !== null && sold ? spend / sold : null,
        afterAdvertising:
          spend !== null && gross !== null
            ? dollars(cents(gross) - cents(spend))
            : null,
        returnPercent:
          spend !== null && spend > 0 && gross !== null
            ? ((gross - spend) / spend) * 100
            : null,
      };
    })
    .sort(
      (a, b) =>
        (b.spend ?? -1) - (a.spend ?? -1) || a.name.localeCompare(b.name),
    );
}
