import { z } from "zod";
import type { InventoryVehicle } from "./vehicles";

const text = (max: number) => z.string().trim().max(max);
const date = z.union([z.literal(""), z.iso.date()]);
const state = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter state."),
]);
const zip = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code."),
]);
export const inventoryTitleLienSchema = z.object({
  name: text(100),
  address: text(150),
  city: text(60),
  state,
  zip,
  id: text(40),
  account: text(60),
  date,
});
export const inventoryTitleSchema = z.object({
  ownerName: text(100).min(1, "Enter the title owner’s company name."),
  ownerId: text(40),
  address: text(150).min(1, "Enter the title owner’s business address."),
  city: text(60).min(1, "Enter the title owner’s city."),
  state: state.refine(Boolean, "Enter the title owner’s state."),
  zip: zip.refine(Boolean, "Enter the title owner’s ZIP code."),
  county: text(60),
  mileage: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole-number odometer reading.")
    .refine(
      (value) => Number(value) <= 3000000,
      "Odometer reading must be 3,000,000 or less.",
    ),
  body: text(40),
  fuel: text(30),
  purchaseDate: date,
  purchasedFrom: text(250),
  sellerDealerNumber: text(40),
  leased: z.enum(["", "yes", "no"]),
  liens: z.tuple([inventoryTitleLienSchema, inventoryTitleLienSchema]),
});
export type InventoryTitleDraft = z.infer<typeof inventoryTitleSchema>;
export type InventoryTitleLien = z.infer<typeof inventoryTitleLienSchema>;
export const emptyTitleLien = (): InventoryTitleLien => ({
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  id: "",
  account: "",
  date: "",
});
export function defaultInventoryTitle(
  vehicle?: Partial<Pick<InventoryVehicle, "mileage" | "acquired_on">>,
): InventoryTitleDraft {
  return {
    ownerName: "DRIVE MAX USED CARS LLC",
    ownerId: "",
    address: "6210 Old US Hwy 70 W",
    city: "New Bern",
    state: "NC",
    zip: "28562",
    county: "Craven",
    mileage: String(vehicle?.mileage ?? 0),
    body: "",
    fuel: "",
    purchaseDate: vehicle?.acquired_on ?? "",
    purchasedFrom: "",
    sellerDealerNumber: "",
    leased: "",
    liens: [emptyTitleLien(), emptyTitleLien()],
  };
}
