export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const normalizeVin = (value: string) =>
  value.replace(/\s/g, "").toUpperCase();

export type DecodedFields = Partial<
  Record<
    | "year"
    | "make"
    | "model"
    | "trim"
    | "body_style"
    | "transmission"
    | "fuel"
    | "drivetrain",
    string
  >
>;
export type DecodedVehicle = {
  vin: string;
  fields: DecodedFields;
  features: string[];
  warning: string;
};
type Row = Record<string, unknown>;
const text = (row: Row, key: string) => {
  const value = typeof row[key] === "string" ? row[key].trim() : "";
  return /^(not applicable|not available|unknown|n\/a)$/i.test(value)
    ? ""
    : value;
};
const positive = (row: Row, key: string) => {
  const n = Number(text(row, key));
  return Number.isFinite(n) && n > 0 ? n : null;
};
export function decodeVpic(payload: unknown, vin: string): DecodedVehicle {
  const results = (payload as { Results?: Row[] })?.Results;
  const row = Array.isArray(results) ? results[0] : null;
  if (!row || typeof row !== "object")
    throw new Error(
      "The VIN service returned no vehicle details. You can enter them manually.",
    );
  const errors = text(row, "ErrorCode")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (errors.some((e) => ["1", "4", "5", "7", "9", "400"].includes(e)))
    throw new Error(
      "NHTSA could not verify this VIN. Check all 17 characters, or enter the details manually.",
    );
  const fields: DecodedFields = {};
  const year = positive(row, "ModelYear");
  if (
    year &&
    Number.isInteger(year) &&
    year >= 1981 &&
    year <= new Date().getFullYear() + 2
  )
    fields.year = String(year);
  for (const [key, source, limit] of [
    ["make", "Make", 60],
    ["model", "Model", 80],
    ["trim", "Trim", 100],
    ["body_style", "BodyClass", 60],
    ["transmission", "TransmissionStyle", 80],
    ["fuel", "FuelTypePrimary", 60],
    ["drivetrain", "DriveType", 60],
  ] as const) {
    const value = text(row, source);
    if (value) fields[key] = value.slice(0, limit);
  }
  if (!fields.year && !fields.make && !fields.model)
    throw new Error(
      "No vehicle details were found for this VIN. You can enter them manually.",
    );
  if (fields.body_style?.includes("Sport Utility")) fields.body_style = "SUV";
  if (fields.body_style?.includes("Sedan")) fields.body_style = "Sedan";
  if (fields.body_style === "Pickup") fields.body_style = "Truck";
  const features: string[] = [];
  const liters = positive(row, "DisplacementL"),
    cylinders = positive(row, "EngineCylinders");
  if (liters)
    features.push(
      `${liters.toFixed(1)}L${cylinders ? ` ${cylinders}-cylinder` : ""} engine`,
    );
  else if (cylinders) features.push(`${cylinders}-cylinder engine`);
  const hp = positive(row, "EngineHP"),
    hpTo = positive(row, "EngineHP_to");
  if (hp)
    features.push(
      `${hp}${hpTo && hpTo > hp ? `–${hpTo}` : ""} horsepower (manufacturer reported)`,
    );
  const speeds = positive(row, "TransmissionSpeeds");
  if (speeds && fields.transmission)
    features.push(
      `${speeds}-speed ${fields.transmission.toLowerCase()} transmission`,
    );
  if (text(row, "Turbo") === "Yes") features.push("Turbocharged engine");
  for (const [key, label] of [
    ["ABS", "Anti-lock brakes"],
    ["ESC", "Electronic stability control"],
    ["TractionControl", "Traction control"],
    ["RearVisibilitySystem", "Backup camera"],
    ["BlindSpotMon", "Blind spot warning"],
    ["LaneDepartureWarning", "Lane departure warning"],
    ["LaneKeepSystem", "Lane keeping assistance"],
    ["ForwardCollisionWarning", "Forward collision warning"],
    ["CIB", "Automatic emergency braking"],
    ["AdaptiveCruiseControl", "Adaptive cruise control"],
    ["KeylessIgnition", "Keyless ignition"],
  ])
    if (text(row, key).toLowerCase() === "standard") features.push(label);
  return {
    vin,
    fields,
    features,
    warning:
      errors.some((e) => e !== "0") ||
      !fields.year ||
      !fields.make ||
      !fields.model
        ? "Some VIN details are unavailable. Fill in the remaining fields manually."
        : "",
  };
}

// Only fill blanks or values from the last lookup; keep subsequent staff edits.
export function mergeDecodedFields<T extends Record<string, string>>(
  current: T,
  decoded: DecodedFields,
  previous: DecodedFields,
): T {
  const next = { ...current };
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(decoded),
  ])) {
    const value = decoded[key as keyof DecodedFields] || "";
    if (
      !current[key]?.trim() ||
      current[key] === previous[key as keyof DecodedFields]
    )
      (next as Record<string, string>)[key] = value;
  }
  return next;
}
export function mergeFeatureLines(
  current: string,
  previous: string[],
  incoming: string[],
) {
  const existing = current
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !previous.includes(s));
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  for (const value of incoming)
    if (!seen.has(value.toLowerCase()) && existing.length < 80) {
      existing.push(value);
      seen.add(value.toLowerCase());
    }
  return existing.join("\n");
}
export type SafetyVariant = { id: number; description: string };
export type SafetyRatings = {
  variant: SafetyVariant;
  ratings: { label: string; stars: number }[];
  features: string[];
};
export function safetyVariants(payload: unknown): SafetyVariant[] {
  const rows = (payload as { Results?: Row[] })?.Results;
  if (!Array.isArray(rows))
    throw new Error("Safety ratings are temporarily unavailable.");
  return rows
    .filter(
      (r) =>
        Number.isInteger(r.VehicleId) &&
        Number(r.VehicleId) > 0 &&
        typeof r.VehicleDescription === "string",
    )
    .map((r) => ({
      id: Number(r.VehicleId),
      description: String(r.VehicleDescription).slice(0, 160),
    }));
}
export function parseSafetyRatings(
  payload: unknown,
  variant: SafetyVariant,
): SafetyRatings {
  const rows = (payload as { Results?: Row[] })?.Results;
  const row = Array.isArray(rows)
    ? rows.find((r) => r.VehicleId === variant.id)
    : null;
  if (!row)
    throw new Error("Ratings were not returned for that vehicle version.");
  const ratings = [
    ["OverallRating", "Overall"],
    ["OverallFrontCrashRating", "Frontal crash"],
    ["OverallSideCrashRating", "Side crash"],
    ["RolloverRating", "Rollover"],
  ].flatMap(([key, label]) => {
    const stars = Number(row[key]);
    return Number.isInteger(stars) && stars >= 1 && stars <= 5
      ? [{ label, stars }]
      : [];
  });
  const features = ratings.length
    ? [
        `NHTSA rated variant: ${variant.description.slice(0, 79)}`,
        ...ratings.map(
          (r) => `NHTSA ${r.label.toLowerCase()}: ${r.stars}/5 stars`,
        ),
      ]
    : [];
  return { variant, ratings, features };
}
