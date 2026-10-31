import { z } from "zod";

const text = z.string().trim().max(250);
const amount = z.number().finite().min(0).max(1000000);
const miles = z.number().int().min(0).max(3000000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v + "T12:00:00Z")) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
    "Enter a valid acquisition date",
  );
export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-HJ-NPR-Z0-9]{17}$/,
    "Enter a 17-character VIN without I, O, or Q",
  );
export const vehicleDetailsSchema = z.object({
  vin: z.union([vinSchema, z.literal("")]),
  year: z.number().int().min(1900).max(2100).nullable(),
  make: text,
  model: text,
  trim: text,
  mileage: miles.nullable(),
  stock_number: text,
  color: text,
  cost: amount.nullable(),
  recon: amount.nullable(),
  price: amount.nullable(),
  acquired_on: date.nullable(),
});
export const inventorySchema = vehicleDetailsSchema.extend({
  vin: vinSchema,
  year: z.number().int().min(1900).max(2100),
  make: text.min(1, "Enter a make"),
  model: text.min(1, "Enter a model"),
  mileage: miles,
  stock_number: text.min(1, "Enter a stock number"),
  cost: amount,
  recon: amount,
  price: amount,
  acquired_on: date,
  status: z.enum(["in_stock", "pending", "sold", "archived"]),
});
export const tradeSchema = z.object({
  vin: vinSchema,
  mileage: miles,
  allowance: amount,
  acv: amount,
  payoff: amount,
  year: z.number().int().min(1900).max(2100).nullable(),
  make: text,
  model: text,
  trim: text,
  description: text,
});
export type VehicleDetails = z.infer<typeof vehicleDetailsSchema>;
export type InventoryInput = z.infer<typeof inventorySchema>;
export type InventoryVehicle = InventoryInput & {
  id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
};
export type Trade = z.infer<typeof tradeSchema>;
export const vehicleName = (
  v: Pick<VehicleDetails, "year" | "make" | "model" | "trim">,
) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
export function inventorySnapshot(v: InventoryVehicle): VehicleDetails {
  return vehicleDetailsSchema.parse({
    ...v,
    cost: v.cost ?? null,
    recon: v.recon ?? null,
  });
}
export function daysOnHand(acquired: string | null | undefined, today: string) {
  return acquired
    ? Math.max(
        0,
        Math.round(
          (Date.parse(today + "T12:00:00Z") -
            Date.parse(acquired + "T12:00:00Z")) /
            86400000,
        ),
      )
    : null;
}
export function normalizeVin(vin: string) {
  return vin.trim().toUpperCase().replace(/\s/g, "");
}
export type DecodedVin = {
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  body: string;
  warning: string | null;
};
export function parseVinDecode(payload: unknown, vin: string): DecodedVin {
  const root = payload as { Results?: Record<string, unknown>[] };
  const r = root?.Results?.[0];
  if (!r)
    throw new Error(
      "The VIN decoder returned no vehicle. Enter the vehicle details manually.",
    );
  const str = (key: string) =>
    typeof r[key] === "string" ? (r[key] as string) : "";
  const rawYear = Number(str("ModelYear"));
  const year = rawYear >= 1900 && rawYear <= 2100 ? rawYear : null;
  const make = str("Make"),
    model = str("Model"),
    trim = str("Trim") || str("Series");
  if (!year && !make && !model)
    throw new Error(
      "No vehicle was identified. Check the VIN or enter the details manually.",
    );
  const errors = str("ErrorCode")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && x !== "0");
  return {
    vin,
    year,
    make,
    model,
    trim,
    body: str("BodyClass"),
    warning:
      errors.length || !year || !make || !model
        ? "The decoder returned incomplete or flagged details. Verify the VIN and confirm the vehicle below."
        : null,
  };
}

// Sales responses omit costs. Supply validation placeholders only; the SQL
// command guard restores authoritative costs/ACV before saving an ordinary edit.
export function opportunityEditorInput<
  T extends { vehicle_details: VehicleDetails | null; trade: Trade | null },
>(value: T, showCosts: boolean): T {
  if (showCosts) return value;
  return {
    ...value,
    vehicle_details: value.vehicle_details
      ? { ...value.vehicle_details, cost: null, recon: null }
      : null,
    trade: value.trade ? { ...value.trade, acv: 0 } : null,
  };
}
