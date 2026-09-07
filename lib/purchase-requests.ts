export const vehicleConditions = [
  "Excellent",
  "Good",
  "Fair",
  "Needs repairs",
  "Not running",
] as const;
export const titleStatuses = [
  "Clean title",
  "Rebuilt or salvage title",
  "Other title brand",
  "Not sure",
] as const;
export const accidentHistories = [
  "No known accidents",
  "Previous accident or damage",
  "Not sure",
] as const;
export const loanStatuses = [
  "Owned outright",
  "Loan balance",
  "Lease",
  "Not sure",
] as const;
export const purchaseLabels: Record<string, string> = {
  sellerVin: "VIN",
  sellerMiles: "Mileage",
  sellerYear: "Year",
  sellerMake: "Make",
  sellerModel: "Model",
  sellerTrim: "Trim",
  condition: "Overall condition",
  titleStatus: "Title status",
  accidentHistory: "Accident / damage history",
  loanStatus: "Loan or lease",
  askingPrice: "Asking price ($)",
  sellerZip: "ZIP code",
  reason: "Request",
  vehicleType: "Vehicle type",
  downPayment: "Planned down payment",
  preferredVisit: "Preferred visit (awaiting confirmation)",
};
export function isPurchaseRequest(lead: { details: Record<string, string> }) {
  return lead.details.purpose === "purchase-offer";
}
export function leadLabel(lead: {
  kind: string;
  details: Record<string, string>;
}) {
  return isPurchaseRequest(lead)
    ? "Purchase offer request"
    : lead.details.purpose === "test-drive"
      ? "Test-drive request"
      : lead.details.purpose === "vehicle-update"
        ? "Availability update request"
        : lead.details.purpose === "similar-vehicle"
          ? "Similar vehicle request"
          : `${lead.kind} inquiry`;
}
export function purchaseSummary(value: {
  sellerYear?: string;
  sellerMake?: string;
  sellerModel?: string;
  sellerTrim?: string;
  sellerVin?: string;
  sellerMiles?: string;
  condition?: string;
  message?: string;
}) {
  const title = [
    value.sellerYear,
    value.sellerMake,
    value.sellerModel,
    value.sellerTrim,
  ]
    .filter(Boolean)
    .join(" ");
  return [
    `Purchase offer requested for ${title}.`,
    `VIN: ${value.sellerVin}`,
    `Mileage: ${Number(value.sellerMiles).toLocaleString("en-US")}`,
    `Condition: ${value.condition}`,
    value.message || "",
  ]
    .filter(Boolean)
    .join("\n");
}
export function purchaseOfferDraft(
  lead: { name: string; details: Record<string, string> },
  input: string | number,
) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(input))) return "";
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 2000000) return "";
  const d = lead.details,
    title = [d.sellerYear, d.sellerMake, d.sellerModel, d.sellerTrim]
      .filter(Boolean)
      .join(" ");
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
  return `Hi ${lead.name},\n\nThank you for telling us about your ${title}. Based on the information you provided, we would like to offer ${price} to purchase it.\n\nVIN: ${d.sellerVin}\nReported mileage: ${Number(d.sellerMiles).toLocaleString("en-US")} miles\n\nThe offer is subject to an in-person inspection and verification of title and any payoff information. Reply to this email and we can arrange a time to see the vehicle.\n\nThank you,\nDrive Max Used Cars`;
}
