import { vinSchema } from "./vehicles";

/** Accept complete VIN payloads, never a 17-character slice of another barcode. */
export function vinFromBarcode(raw: string): string | null {
  if (raw.length > 100) return null;
  let value = raw
    .trim()
    .toUpperCase()
    .replace(/^\][A-Z][0-9]/, "");
  value = value.replace(/^VIN[\s:#=-]*/, "").trim();
  if (value.startsWith("*") && value.endsWith("*")) value = value.slice(1, -1);
  // Some vehicle labels include an I data identifier ahead of the VIN.
  if (/^I[A-HJ-NPR-Z0-9]{17}$/.test(value)) value = value.slice(1);
  const parsed = vinSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Two matching reads within two seconds reduce accidental camera misreads. */
export function vinReadTracker() {
  let previous = "",
    seenAt = 0;
  return (value: string | null, now = Date.now()): string | null => {
    if (!value) return null;
    const stable = value === previous && now - seenAt <= 2000;
    previous = value;
    seenAt = now;
    return stable ? value : null;
  };
}

export function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow camera access for this CRM in your browser settings, then try again. You can also scan a photo or enter the VIN.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No usable camera was found. Scan a photo or enter the VIN instead.";
  if (name === "NotReadableError" || name === "AbortError")
    return "The camera could not start. Close any other app using it, then try again, or scan a photo.";
  return "The scanner could not start. Try again, scan a photo, or enter the VIN manually.";
}
