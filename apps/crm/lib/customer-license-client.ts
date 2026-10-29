import type { LicenseCapture, SavedLicense } from "./license-scan";
// Demo photos live only in this tab's memory, never localStorage or the server.
const demoLicenses = new Map<string, SavedLicense>();
const demoImages = new Map<string, string>();
export const licenseSavedEvent = "dmcrm-license-saved";
export function licenseImageUrl(license: SavedLicense, demo: boolean) {
  return demo
    ? (demoImages.get(license.id) ?? "")
    : `/api/customer-licenses/${license.id}`;
}
export async function customerLicense(
  customerId: string,
  demo: boolean,
  signal?: AbortSignal,
): Promise<SavedLicense | null> {
  if (demo) return demoLicenses.get(customerId) ?? null;
  const response = await fetch(
    `/api/customer-licenses?customer_id=${encodeURIComponent(customerId)}`,
    { cache: "no-store", signal },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "License could not be loaded.");
  return data.license;
}
export async function saveCustomerLicense(
  customerId: string,
  capture: LicenseCapture,
  demo: boolean,
) {
  if (demo) {
    if (!demoImages.has(capture.id))
      demoImages.set(capture.id, URL.createObjectURL(capture.file));
    demoLicenses.set(customerId, {
      id: capture.id,
      license_portrait: capture.crop,
      created_at: new Date().toISOString(),
    });
  } else {
    const data = new FormData();
    data.set("id", capture.id);
    data.set("customer_id", customerId);
    data.set("crop", JSON.stringify(capture.crop));
    data.set("file", capture.file);
    const response = await fetch("/api/customer-licenses", {
      method: "POST",
      body: data,
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(
        result.error ||
          "The customer is saved. Retry the license photo upload.",
      );
  }
  window.dispatchEvent(
    new CustomEvent(licenseSavedEvent, { detail: customerId }),
  );
}
