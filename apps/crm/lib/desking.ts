import {
  type Customer,
  type Quote,
  type QuoteValues,
  defaultQuote,
} from "./model";
import { type InventoryVehicle, type Trade } from "./vehicles";
const tradeKeys: (keyof Trade)[] = [
  "vin",
  "mileage",
  "allowance",
  "acv",
  "payoff",
  "year",
  "make",
  "model",
  "trim",
  "description",
];
// Use the same saved choices (and legacy defaults) on screen and on the quote.
export function deskingPaymentOptions(values: QuoteValues) {
  return {
    terms: values.financeOptions ?? [
      { months: 36, apr: values.apr },
      { months: 48, apr: values.apr },
      {
        months: values.months,
        apr: values.apr,
        lenderFinance: values.lenderFinance,
      },
    ],
    downs: values.downPayments ?? [
      values.downPayment,
      values.downPayment + 500,
      values.downPayment + 1000,
    ],
  };
}
export function deskingDraft(
  base: QuoteValues,
  previouslySaved = false,
): QuoteValues {
  const options = deskingPaymentOptions(base);
  return {
    ...base,
    mode: base.mode ?? "finance",
    showAPR: base.showAPR ?? true,
    showProtectionProducts: base.showProtectionProducts ?? true,
    taxMode: base.taxMode ?? (previouslySaved ? "manual" : "auto"),
    taxReason:
      base.taxReason ?? (previouslySaved ? "Previously saved estimate" : ""),
    addOns: base.addOns ?? 0,
    serviceContract: base.serviceContract ?? 0,
    otherTaxes: base.otherTaxes ?? 0,
    daysToFirstPayment: base.daysToFirstPayment ?? (previouslySaved ? 30 : 45),
    financeOptions: options.terms,
    downPayments: options.downs,
    selectedOption: base.selectedOption ?? 2,
    selectedDown: base.selectedDown ?? 0,
  };
}
export function selectedDeskingValues(draft: QuoteValues): QuoteValues {
  const { terms, downs } = deskingPaymentOptions(draft);
  const selected = terms[draft.selectedOption ?? 2];
  return {
    ...draft,
    apr: draft.mode === "cash" ? 0 : selected.apr,
    months: selected.months,
    lenderFinance: selected.lenderFinance,
    downPayment:
      draft.mode === "cash"
        ? draft.downPayment
        : downs[draft.selectedDown ?? 0],
  };
}
export function deskingDefaults(
  customer: Customer,
  inventory: InventoryVehicle[],
  latest?: Quote,
): QuoteValues {
  const vehicle =
    inventory.find((v) => v.id === customer.inventory_id) ??
    customer.vehicle_details;
  const matches =
    !!latest &&
    (customer.inventory_id
      ? latest.inventory_id === customer.inventory_id
      : !latest.inventory_id && latest.vehicle === customer.vehicle_interest);
  const base = matches
    ? latest.values
    : { ...defaultQuote, price: vehicle?.price ?? 0 };
  const sameTrade =
    matches &&
    customer.trade &&
    latest.trade_input &&
    tradeKeys.every((k) => customer.trade?.[k] === latest.trade_input?.[k]);
  return {
    ...base,
    ...(customer.trade && !sameTrade
      ? {
          tradeAllowance: customer.trade.allowance,
          acv: customer.trade.acv,
          payoff: customer.trade.payoff,
        }
      : customer.trade || customer.trade_vehicle
        ? {}
        : { tradeAllowance: 0, acv: 0, payoff: 0 }),
  };
}
