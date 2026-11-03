import { PDFDocument, PDFCheckBox } from "pdf-lib";
import { soldForms, type PaperValues } from "./documents";
import { buildSoldPack } from "./pdf-output";
import {
  inventoryTitleSchema,
  type InventoryTitleDraft,
} from "./inventory-title";
import type { PrintVehicle } from "./inventory-print";
import type { PrintAssetLoader } from "./inventory-print-pdf";

const date = (value: string) =>
  value
    ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`
    : "";

/** The inventory owner is the dealership; no customer, quote or sale context is used. */
export function inventoryTitleValues(
  vehicle: PrintVehicle,
  input: InventoryTitleDraft,
) {
  const title = inventoryTitleSchema.parse(input);
  const context: PaperValues = {
    "buyer.name": title.ownerName,
    "buyer.license_number": title.ownerId,
    "buyer.residence_address": title.address,
    "buyer.residence_city": title.city,
    "buyer.residence_state": title.state.toUpperCase(),
    "buyer.residence_zip": title.zip,
    "buyer.county": title.county,
    "vehicle.year": String(vehicle.year),
    "vehicle.make": vehicle.make,
    "vehicle.model_trim": [vehicle.model, vehicle.trim]
      .filter(Boolean)
      .join(" "),
    "vehicle.vin": vehicle.vin,
    "vehicle.mileage": String(Number(title.mileage)),
    "vehicle.body": title.body,
    "vehicle.fuel": title.fuel,
    "deal.date": date(title.purchaseDate),
    // These fields describe the selling party, never Drive Max by default.
    "dealer.name_address": title.purchasedFrom,
    "dealer.number": title.sellerDealerNumber,
  };
  for (const [key, value] of Object.entries(title.liens[0]))
    context[`lienholder.${key}`] =
      key === "date"
        ? date(value)
        : key === "state"
          ? value.toUpperCase()
          : value;
  const second = title.liens[1];
  const fields: PaperValues = {
    "Check Box Title Only - Vehicle Not in Operation": true,
    "CheckBox Vehicle Purchased Used": true,
    "Check Box Yes if Vehicle is Leased": title.leased === "yes",
    "Check Box No If Vehicle is Not Leased": title.leased === "no",
    "Enter Date of 2nd Lien": date(second.date),
    "Enter 2nd Lien Account Number": second.account,
    "Enter 2nd LIenholder's ID Number": second.id,
    "Enter 2nd Lienholder's Name": second.name,
    "Enter 2nd Lienholder's Address": second.address,
    "Enter 2nd Lienholder's City": second.city,
    "Enter 2nd Lienholder's State": second.state.toUpperCase(),
    "Enter 2nd Lienholder's Zip Code": second.zip,
  };
  return { context, paperwork: { "MVR-1": fields } };
}

export async function buildInventoryTitlePdf(
  vehicle: PrintVehicle,
  title: InventoryTitleDraft,
  load: PrintAssetLoader,
) {
  const template = soldForms.find((form) => form.id === "MVR-1");
  if (!template)
    throw new Error("The MVR-1 title application template is unavailable.");
  const { context, paperwork } = inventoryTitleValues(vehicle, title);
  // Reuse the established NC field fitting and print flattening. Initials,
  // signatures, notarization, registration and insurance remain unfilled.
  return buildSoldPack(
    context,
    paperwork,
    async () => {
      const source = await PDFDocument.load(await load("/api/forms/MVR-1"));
      // The official MVR-1's Used/New widgets have stale /On appearances that
      // draw an empty box. Regenerate real check marks in this print copy only.
      for (const field of source.getForm().getFields())
        if (field instanceof PDFCheckBox) {
          for (const widget of field.acroField.getWidgets()) {
            widget.getOrCreateBorderStyle().setWidth(0.6);
            widget.getOrCreateAppearanceCharacteristics().setBorderColor([0]);
          }
          field.updateAppearances();
        }
      return source.save();
    },
    [template],
  );
}
