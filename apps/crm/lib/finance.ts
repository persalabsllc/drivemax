import type { FIProduct } from "./operations";
import type { FIMenu } from "./fi-menu";
export type LenderFinance = {
  lender: string;
  buyRate: number | null;
  payoutPercent: number;
  reserveOverride: number | null;
  lenderFees: number;
};
export type FinanceOption = {
  months: number;
  apr: number;
  lenderFinance?: LenderFinance;
};
export type FinanceValues = {
  lenderFinance?: LenderFinance;
  fiMenu?: FIMenu;
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
  showAPR?: boolean;
  showProtectionProducts?: boolean;
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

export const emptyLenderFinance: LenderFinance = {
  lender: "",
  buyRate: null,
  payoutPercent: 100,
  reserveOverride: null,
  lenderFees: 0,
};

// Estimate using the same rounded payments and odd-days convention as desking.
// A bank's actual settlement can differ; its confirmed amount takes precedence.
export function lenderFinanceMath(v: FinanceValues) {
  const f = v.mode === "cash" ? undefined : v.lenderFinance;
  const { balance, payment } = calculateQuote(v);
  const buyPayment =
    f?.buyRate == null
      ? null
      : financePayment(balance, f.buyRate, v.months, v.daysToFirstPayment ?? 30)
          .payment;
  // Integer cents and percentage basis points avoid half-cent float drift
  // between the browser estimate and PostgreSQL's decimal accounting math.
  const spreadCents = Math.max(
    0,
    Math.round(payment * 100) - Math.round((buyPayment ?? payment) * 100),
  );
  const payoutBasisPoints = Math.round((f?.payoutPercent ?? 100) * 100);
  const estimatedReserve =
    Math.round((spreadCents * v.months * payoutBasisPoints) / 10_000) / 100;
  return {
    buyPayment,
    estimatedReserve,
    reserve:
      f?.reserveOverride != null ? cents(f.reserveOverride) : estimatedReserve,
    lenderFees: cents(f?.lenderFees ?? 0),
    source:
      f?.reserveOverride != null
        ? ("confirmed" as const)
        : ("estimate" as const),
  };
}

// Freeze once when sold; subsequent accounting corrections remain authoritative.
export function lenderAccounting(v?: FinanceValues) {
  const f = v?.mode === "cash" ? undefined : v?.lenderFinance;
  if (!v || !f) return {};
  const m = lenderFinanceMath(v);
  return {
    lender: f.lender,
    buy_rate: f.buyRate,
    finance_reserve: m.reserve,
    lender_fees: m.lenderFees,
    finance_reserve_source: m.source,
  };
}
