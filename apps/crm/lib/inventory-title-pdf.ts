import { PDFDocument, PDFCheckBox, PDFDict, PDFName } from "pdf-lib";
import { soldForms, type PaperValues } from "./documents";
import { fillPdfForm } from "./pdf-output";
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
  const pdf = await PDFDocument.load(await load("/api/forms/MVR-1"));
  // Keep the native fields writable, including blank fields for manual entry.
  for (const field of pdf.getForm().getFields()) {
    field.disableReadOnly();
    // The official Used/New widgets have stale /On appearances that draw an
    // empty box. Regenerate check marks in this editable copy only.
    if (field instanceof PDFCheckBox) {
      for (const widget of field.acroField.getWidgets()) {
        widget.getOrCreateBorderStyle().setWidth(0.6);
        widget.getOrCreateAppearanceCharacteristics().setBorderColor([0]);
      }
      field.updateAppearances();
    }
  }
  await fillPdfForm(pdf, template, context, paperwork);
  // PDF editors use /DA + /DR to redraw text after a user types. Keep the
  // fill font in both the form and any inherited template field resources,
  // rather than only in the already-rendered widget appearances.
  const form = pdf.getForm();
  const font = form.getDefaultFont();
  const resourceDictionaries = [
    form.acroForm.dict,
    ...form.getFields().map((field) => field.acroField.dict),
  ];
  for (const dictionary of resourceDictionaries) {
    let resources = dictionary.lookupMaybe(PDFName.of("DR"), PDFDict);
    if (!resources) {
      resources = pdf.context.obj({});
      dictionary.set(PDFName.of("DR"), resources);
    }
    let fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) {
      fonts = pdf.context.obj({});
      resources.set(PDFName.of("Font"), fonts);
    }
    fonts.set(PDFName.of(font.name), font.ref);
  }
  // Initials and signatures remain blank; the application stays interactive.
  return pdf.save();
}
