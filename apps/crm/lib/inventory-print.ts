import { z } from "zod";
import { vinSchema, type InventoryVehicle } from "./vehicles";
import {
  emptyStickerSpecs,
  stickerSpecsSchema,
} from "./vehicle-specifications";

// Public vehicle fields only. Never pass acquisition costs, recon, or deal data
// to a customer-facing document.
export const printVehicleSchema = z.object({
  vin: vinSchema,
  year: z.number().int().min(1900).max(2100),
  make: z.string().trim().min(1).max(250),
  model: z.string().trim().min(1).max(250),
  trim: z.string().trim().max(250),
  stock_number: z.string().trim().min(1).max(250),
  mileage: z.number().int().min(0).max(3000000),
  color: z.string().trim().max(250),
});
export type PrintVehicle = z.infer<typeof printVehicleSchema>;
const text = (label: string, max: number) =>
  z.string().trim().max(max, `${label} is too long for the printed document.`);
const numericText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, `Enter a valid ${label}.`)
    .transform(Number)
    .pipe(
      z.number().finite().min(0).max(max, `${label} must be ${max} or less.`),
    );

export const printMaterialsSchema = z
  .object({
    sticker: z.boolean(),
    buyersGuide: z.boolean(),
    price: numericText("vehicle price", 1000000),
    administrationFee: numericText("administration fee", 10000),
    highlights: text("Vehicle highlights", 500),
    specifications: stickerSpecsSchema.default(emptyStickerSpecs),
    warranty: z.enum(["dealer", "as_is", "implied"]),
    warrantyType: z.enum(["limited", "full"]),
    labor: numericText("labor percentage", 100),
    parts: numericText("parts percentage", 100),
    systems: text("Covered systems", 600),
    duration: text("Warranty duration", 200),
    serviceContract: z.boolean(),
    manufacturerWarranty: z.boolean(),
    manufacturerUsedWarranty: z.boolean(),
    otherUsedWarranty: z.boolean(),
    dealerName: text("Dealer name", 100).min(1, "Enter the dealer name."),
    address: text("Dealer address", 150).min(1, "Enter the dealer address."),
    phone: text("Dealer phone", 40).min(1, "Enter the dealer phone number."),
    email: text("Dealer email", 100).email("Enter a valid dealer email."),
    website: text("Dealer website", 100).min(1, "Enter the dealer website."),
    complaintsContact: text("Complaints contact", 120).min(
      1,
      "Enter the complaints contact name or position.",
    ),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (!value.sticker && !value.buyersGuide)
      issue("sticker", "Select a window sticker, Buyers Guide, or both.");
    if (value.sticker && value.price <= 0)
      issue(
        "price",
        "Enter a vehicle price greater than zero for the window sticker.",
      );
    if (value.buyersGuide && value.warranty === "dealer") {
      if (!value.systems)
        issue("systems", "Enter the systems covered by the dealer warranty.");
      if (!value.duration)
        issue("duration", "Enter the dealer warranty duration.");
    }
  });

export type PrintMaterialsDraft = z.input<typeof printMaterialsSchema>;
export type PrintMaterials = z.output<typeof printMaterialsSchema>;
export function defaultPrintMaterials(
  vehicle: Pick<InventoryVehicle, "price">,
): PrintMaterialsDraft {
  return {
    sticker: true,
    buyersGuide: true,
    price: String(vehicle.price),
    // Same itemization as the website's lib/vehicle-pricing.ts.
    administrationFee: "399",
    highlights: "",
    specifications: emptyStickerSpecs(),
    warranty: "dealer",
    warrantyType: "limited",
    labor: "100",
    parts: "100",
    // Drive_Max_Limited_Powertrain_Warranty.pdf, DM-W01 Rev 10/2026.
    systems:
      "Engine: internally lubricated, moving components only.\nTransmission: internally lubricated, moving components only.\nMechanical failure only. No deductible. Other components excluded; see written warranty.",
    duration: "14 days or 500 miles after delivery, whichever occurs first.",
    serviceContract: true,
    manufacturerWarranty: false,
    manufacturerUsedWarranty: false,
    otherUsedWarranty: false,
    dealerName: "Drive Max Used Cars LLC",
    address: "6210 Old US Hwy 70 W, New Bern, NC 28562",
    phone: "(252) 541-0040",
    email: "sales@drivemaxusedcars.com",
    website: "DriveMaxUsedCars.com",
    complaintsContact: "General Manager",
  };
}

export const stickerTotal = (price: number, fee: number) =>
  (Math.round(price * 100) + Math.round(fee * 100)) / 100;

export function printMaterialsFilename(
  vehicle: PrintVehicle,
  options: Pick<PrintMaterials, "sticker" | "buyersGuide">,
) {
  const stock =
    vehicle.stock_number.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40) ||
    vehicle.vin;
  const kind =
    options.sticker && options.buyersGuide
      ? "print-materials"
      : options.sticker
        ? "window-sticker"
        : "buyers-guide";
  return `drive-max-${stock}-${kind}.pdf`;
}
