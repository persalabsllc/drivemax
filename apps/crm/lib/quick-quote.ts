import type {
  Command,
  PrintableQuote,
  QuickQuoteInput,
  Workspace,
} from "./model";
import {
  inventorySnapshot,
  vehicleName,
  type InventoryVehicle,
} from "./vehicles";

export const quickQuoteVehicleLabel = (
  quote: QuickQuoteInput,
  vehicle?: InventoryVehicle,
) =>
  vehicle
    ? vehicleName(vehicle)
    : quote.vehicle.trim() || "Vehicle to be selected";

// This is a print document only: no database IDs or customer record are created.
export function printableQuickQuote(
  quote: QuickQuoteInput,
  inventory: InventoryVehicle[],
  now = new Date(),
): PrintableQuote {
  const vehicle = inventory.find(
    (v) => v.id === quote.inventory_id && v.status === "in_stock",
  );
  if (quote.inventory_id && !vehicle)
    throw Error(
      "That vehicle is no longer in stock. Select another vehicle or use a manual price.",
    );
  return {
    vehicle: quickQuoteVehicleLabel(quote, vehicle),
    values: quote.values,
    created_at: now.toISOString(),
    vehicle_details: vehicle ? inventorySnapshot(vehicle) : null,
    snapshot_version: 1,
    trade_snapshot: null,
  };
}

export function demoQuickQuote(
  ws: Workspace,
  command: Extract<Command, { type: "convert_quick_quote" }>,
  now: Date,
  run: (ws: Workspace, command: Command, now: Date) => Workspace,
): Workspace {
  const existing = ws.quick_quote_conversions?.[command.id];
  if (existing) return ws;
  const q = command.quote;
  const vehicle = ws.inventory.find(
    (v) =>
      v.id === q.inventory_id &&
      v.org_id === ws.org.id &&
      v.status === "in_stock",
  );
  if (q.inventory_id && !vehicle)
    throw Error(
      "That vehicle is no longer in stock. Select another vehicle or use a manual price.",
    );
  const label = quickQuoteVehicleLabel(q, vehicle);
  let next = run(
    ws,
    {
      type: "create_customer",
      customer: { ...command.customer, initial_opportunity: false },
    },
    now,
  );
  const customerId = next.customers[0].id;
  next = run(
    next,
    {
      type: "create_opportunity",
      customer_id: customerId,
      opportunity: {
        title: label,
        source: command.customer.source,
        status: "working",
        inventory_id: q.inventory_id,
        vehicle_interest: label,
        vehicle_details: null,
        trade: null,
        trade_vehicle:
          q.values.tradeAllowance ||
          q.values.payoff ||
          q.values.acv ||
          q.values.recon
            ? "Trade details pending"
            : "",
      },
    },
    now,
  );
  next = run(
    next,
    {
      type: "save_quote",
      customer_id: customerId,
      opportunity_id: next.opportunities[0].id,
      vehicle: label,
      values: q.values,
    },
    now,
  );
  next.quick_quote_conversions = {
    ...next.quick_quote_conversions,
    [command.id]: {
      customer_id: customerId,
      opportunity_id: next.opportunities[0].id,
    },
  };
  next.activities.unshift({
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    customer_id: customerId,
    opportunity_id: next.opportunities[0].id,
    kind: "system",
    body: "Quick quote saved to new customer profile",
    created_at: now.toISOString(),
    created_by: ws.member.name,
  });
  return next;
}
