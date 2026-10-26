import type { FIProduct } from "./operations";
export type FinanceOption = { months: number; apr: number };
export type FinanceValues = {
  products?: FIProduct[];
  price: number;
  docFee: number;
  tax: number;
  titleFee: number;
  tradeAllowance: number;
  payoff: number;
  downPayment: number;
  apr: number;
  months: number;
  acv: number;
  recon: number;
  mode?: "cash" | "finance";
  taxMode?: "auto" | "manual";
  taxReason?: string;
  addOns?: number;
  serviceContract?: number;
  otherTaxes?: number;
  daysToFirstPayment?: number;
  financeOptions?: FinanceOption[];
  downPayments?: number[];
  selectedOption?: number;
  selectedDown?: number;
};
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function highwayUseTax(v: FinanceValues) {
  return cents(
    Math.max(0, v.price + v.docFee + (v.addOns || 0) - v.tradeAllowance) * 0.03,
  );
}
export function financePayment(
  principal: number,
  apr: number,
  months: number,
  days = 45,
) {
  // Illustrative odd-days method: regular 30-day first period plus actual/365 simple interest for additional days.
  const extraDays = Math.max(0, days - 30),
    firstPeriodInterest = cents(
      (((Math.max(0, principal) * apr) / 100) * extraDays) / 365,
    );
  const adjusted = Math.max(0, principal) + firstPeriodInterest,
    r = apr / 1200;
  const payment =
    adjusted <= 0
      ? 0
      : r
        ? (adjusted * r) / (1 - Math.pow(1 + r, -Math.max(1, months)))
        : adjusted / Math.max(1, months);
  return { payment: cents(payment), firstPeriodInterest, extraDays };
}
export function calculateQuote(v: FinanceValues) {
  const tax = v.taxMode === "auto" ? highwayUseTax(v) : v.tax;
  const total = cents(
    v.price +
      v.docFee +
      (v.addOns || 0) +
      (v.products
        ? cents(v.products.reduce((s, p) => s + p.price, 0))
        : v.serviceContract || 0) +
      (v.otherTaxes || 0) +
      tax +
      v.titleFee -
      v.tradeAllowance +
      v.payoff,
  );
  const balance = cents(total - v.downPayment);
  const payment = financePayment(
    balance,
    v.apr,
    v.months,
    v.daysToFirstPayment ?? 30,
  );
  return {
    total,
    balance,
    tax,
    taxBase: cents(
      Math.max(0, v.price + v.docFee + (v.addOns || 0) - v.tradeAllowance),
    ),
    ...payment,
  };
}
