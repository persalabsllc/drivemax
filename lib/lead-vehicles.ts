import type { Vehicle } from "./inventory";

export type LeadVehicle = Pick<
  Vehicle,
  | "id"
  | "slug"
  | "year"
  | "make"
  | "model"
  | "trim"
  | "vin"
  | "stock_number"
  | "miles"
  | "status"
>;
export const leadVehicleColumns =
  "id,slug,year,make,model,trim,vin,stock_number,miles,status";
export const openLeadStatuses = ["new", "contacted", "appointment"];
export const vehicleInquiryPurposes = [
  "test-drive",
  "vehicle-update",
  "similar-vehicle",
] as const;
export function leadVehicleTitle(v: LeadVehicle) {
  return `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`;
}
type SnapshotField = "Id" | "Title" | "Vin" | "Miles" | "Stock" | "CapturedAt";
export function vehicleSnapshot<P extends "originalVehicle" | "assignedVehicle">(
  v: LeadVehicle,
  prefix: P,
  capturedAt: string,
) {
  return {
    [`${prefix}Id`]: v.id,
    [`${prefix}Title`]: leadVehicleTitle(v),
    [`${prefix}Vin`]: v.vin,
    [`${prefix}Miles`]: String(v.miles),
    [`${prefix}Stock`]: v.stock_number,
    [`${prefix}CapturedAt`]: capturedAt,
  } as Record<`${P}${SnapshotField}`, string>;
}
export function isVehicleSnapshotKey(key: string) {
  return key.startsWith("originalVehicle") || key.startsWith("assignedVehicle");
}

// Only call with a vehicle loaded by the server. Never trust submitted VIN or mileage.
export function captureVehicleInquiry<
  T extends { purpose?: string; message: string; preferredVisit?: string },
>(input: T, vehicle: LeadVehicle, capturedAt: string) {
  if (!["available", "pending", "sold"].includes(vehicle.status))
    throw new Error("This vehicle is no longer listed.");
  if (input.purpose === "test-drive" && vehicle.status !== "available")
    throw new Error(
      "This vehicle's availability changed. Refresh the listing before requesting a visit.",
    );
  const purpose =
    vehicle.status === "sold"
      ? "similar-vehicle"
      : vehicle.status === "pending"
        ? "vehicle-update"
        : input.purpose;
  const reason =
    purpose === "test-drive"
      ? "Test drive requested"
      : purpose === "similar-vehicle"
        ? "Request a vehicle similar to this sold listing"
        : purpose === "vehicle-update"
          ? "Request an update on this pending vehicle"
          : "Vehicle inquiry";
  const preferredVisit =
    purpose === "test-drive" ? input.preferredVisit || "" : "";
  return {
    ...input,
    ...vehicleSnapshot(vehicle, "originalVehicle", capturedAt),
    ...vehicleSnapshot(vehicle, "assignedVehicle", capturedAt),
    vehicleId: vehicle.id,
    vehicle: leadVehicleTitle(vehicle),
    purpose,
    reason,
    preferredVisit,
    message: [
      `${reason}: ${leadVehicleTitle(vehicle)}.`,
      `Stock: ${vehicle.stock_number} · VIN: ${vehicle.vin}`,
      `Listed mileage: ${vehicle.miles.toLocaleString("en-US")} miles`,
      preferredVisit
        ? `Preferred visit: ${preferredVisit} (not confirmed)`
        : "",
      input.message,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function updateVehicleAssignment(
  details: Record<string, string>,
  previous: LeadVehicle | null,
  next: LeadVehicle | null,
  capturedAt: string,
) {
  const result = { ...details };
  // Preserve the first linked car for older leads when they are next updated.
  if (previous && !result.originalVehicleId)
    Object.assign(
      result,
      vehicleSnapshot(previous, "originalVehicle", capturedAt),
    );
  if (
    !next ||
    next.id !== previous?.id ||
    result.assignedVehicleId !== next.id
  ) {
    for (const key of Object.keys(result))
      if (key.startsWith("assignedVehicle")) delete result[key];
    if (next)
      Object.assign(
        result,
        vehicleSnapshot(next, "assignedVehicle", capturedAt),
      );
  }
  return result;
}
