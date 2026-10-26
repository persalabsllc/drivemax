export type WebsiteInventoryLink = {
  inventory_id: string;
  website_id: string | null;
  state: "pending" | "blocked" | "synced";
  error_code: string | null;
  synced_at: string | null;
  listing_status:
    | "draft"
    | "available"
    | "pending"
    | "sold"
    | "archived"
    | null;
  website_price: number | null;
};

export const controlRoomInventoryUrl =
  "https://www.drivemaxusedcars.com/control-room?tab=inventory";
export const websiteListingEditorUrl = (id: string) =>
  `${controlRoomInventoryUrl}&vehicle=${encodeURIComponent(id)}#vehicle-editor`;

export function websiteInventoryLabel(link?: WebsiteInventoryLink) {
  if (!link || link.state === "pending") return "Waiting to sync";
  if (link.state === "blocked") return "Needs review";
  if (!link.website_id) return "Not listed";
  return {
    draft: "Website draft",
    available: "Published",
    pending: "Website pending",
    sold: "Website sold",
    archived: "Website archived",
  }[link.listing_status ?? "draft"];
}

export function websiteInventoryIssue(link?: WebsiteInventoryLink) {
  if (link?.error_code === "stock_conflict")
    return "This stock number belongs to another website vehicle. Correct the CRM stock number to sync.";
  if (link?.error_code === "vin_conflict")
    return "This VIN belongs to another website listing. Review both records before changing the CRM VIN.";
  if (link?.error_code === "website_limits")
    return "Review the vehicle details: website limits are 40 characters for stock, 60 for make/color, 80 for model, 100 for trim, 2,000,000 miles, and model years up to two years ahead.";
  if (link?.state === "pending")
    return "Saved in CRM. Website sync will retry automatically; refresh to check its progress.";
  return "";
}
