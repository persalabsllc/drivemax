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
