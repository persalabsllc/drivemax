import { z } from "zod";
import { vinSchema } from "./vehicles";

const short = z.string().trim().max(90);
const mpg = z
  .string()
  .trim()
  .refine(
    (v) =>
      v === "" ||
      (/^\d{1,3}(\.\d)?$/.test(v) && Number(v) > 0 && Number(v) <= 500),
    "Enter a fuel-economy rating between 0.1 and 500, or leave it blank.",
  );
export const stickerSpecsSchema = z.object({
  engine: short,
  horsepower: z.string().trim().max(25),
  transmission: short,
  drivetrain: short,
  fuel: short,
  body: short,
  features: z
    .string()
    .trim()
    .max(1000)
    .refine(
      (v) => v.split(/\r?\n/).filter((s) => s.trim()).length <= 12,
      "Use up to 12 equipment lines on the window sticker.",
    ),
  cityMpg: mpg,
  highwayMpg: mpg,
  combinedMpg: mpg,
  economyUnit: z.enum(["MPG", "MPGe"]),
  economyFuel: short,
  epaId: z.string().regex(/^\d{1,6}$|^$/),
  epaLabel: z.string().max(200),
  vinDecoded: z.boolean(),
});
export type StickerSpecs = z.infer<typeof stickerSpecsSchema>;
export const emptyStickerSpecs = (): StickerSpecs => ({
  engine: "",
  horsepower: "",
  transmission: "",
  drivetrain: "",
  fuel: "",
  body: "",
  features: "",
  cityMpg: "",
  highwayMpg: "",
  combinedMpg: "",
  economyUnit: "MPG",
  economyFuel: "",
  epaId: "",
  epaLabel: "",
  vinDecoded: false,
});
export const specsLookupSchema = z.object({
  vin: vinSchema,
  year: z.coerce.number().int().min(1900).max(2100),
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
});
export type SpecsIdentity = z.infer<typeof specsLookupSchema>;
export type EpaOption = { id: string; model: string; label: string };
export type SpecsLookup = {
  specs: StickerSpecs;
  options: EpaOption[];
  warnings: string[];
};
export const normalizeName = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]/g, "");
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const value = (r: Record<string, unknown>, k: string) => {
  const v =
    typeof r[k] === "string" || typeof r[k] === "number"
      ? String(r[k]).trim()
      : "";
  return /^(not applicable|not available|unknown|n\/a)$/i.test(v) ? "" : v;
};
const positive = (v: string) =>
  v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;

export function parseStickerVin(
  payload: unknown,
  identity: SpecsIdentity,
): StickerSpecs {
  const root = record(payload);
  const r = record(Array.isArray(root.Results) ? root.Results[0] : null);
  const s = (key: string) => value(r, key);
  if (
    !s("Make") ||
    !s("Model") ||
    (s("VIN") !== "" &&
      s("VIN").toUpperCase() !== identity.vin.toUpperCase()) ||
    s("ModelYear") !== String(identity.year) ||
    normalizeName(s("Make")) !== normalizeName(identity.make) ||
    normalizeName(s("Model")) !== normalizeName(identity.model)
  )
    throw new Error(
      "The VIN result does not match the saved year, make and model. Verify the inventory record before importing specifications.",
    );
  if (
    !s("ErrorCode") ||
    s("ErrorCode")
      .split(",")
      .some((code) => code.trim() !== "0" && code.trim() !== "")
  )
    throw new Error(
      "NHTSA flagged this VIN. Verify it in inventory before importing specifications.",
    );
  const specs = emptyStickerSpecs();
  const liters = positive(s("DisplacementL"));
  const cylinders = positive(s("EngineCylinders"));
  const layout = s("EngineConfiguration");
  specs.engine = [
    liters ? `${Number(liters.toFixed(1)).toFixed(1)}L` : "",
    cylinders
      ? layout === "V-Shaped"
        ? `V${cylinders}`
        : layout === "In-Line"
          ? `Inline ${cylinders}`
          : `${cylinders}-cylinder`
      : "",
    s("ElectrificationLevel").startsWith("BEV") ? "Electric" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const hp = positive(s("EngineHP")),
    hpTo = positive(s("EngineHP_to"));
  specs.horsepower = hp
    ? hpTo && hpTo > hp
      ? `${hp}-${hpTo}`
      : String(hp)
    : "";
  specs.transmission = [
    s("TransmissionSpeeds") ? `${s("TransmissionSpeeds")}-speed` : "",
    s("TransmissionStyle"),
  ]
    .filter(Boolean)
    .join(" ");
  specs.drivetrain = s("DriveType").split("/").pop() || "";
  specs.fuel = [s("FuelTypePrimary"), s("FuelTypeSecondary")]
    .filter(Boolean)
    .join(" / ");
  specs.body = s("BodyClass");
  const features: string[] = [];
  if (positive(s("Doors")))
    features.push(
      `${s("Doors")}-door ${s("BodyClass").replace("/Saloon", "").toLowerCase() || "body"}`,
    );
  if (positive(s("Seats"))) features.push(`${s("Seats")}-passenger seating`);
  const standards = [
    ["ABS", "Anti-lock braking system"],
    ["ESC", "Electronic stability control"],
    ["TractionControl", "Traction control"],
    ["BackupCamera", "Rearview camera"],
    ["BlindSpotMon", "Blind-spot monitoring"],
    ["LaneDepartureWarning", "Lane departure warning"],
    ["ForwardCollisionWarning", "Forward collision warning"],
    ["AdaptiveCruiseControl", "Adaptive cruise control"],
    ["KeylessIgnition", "Keyless ignition"],
    ["DaytimeRunningLight", "Daytime running lights"],
  ];
  for (const [key, label] of standards)
    if (/^standard$/i.test(s(key))) features.push(label);
  if (/^(direct|indirect)$/i.test(s("TPMS")))
    features.push("Tire pressure monitoring");
  if (s("AirBagLocFront").includes("1st Row"))
    features.push("Driver & front passenger airbags");
  if (s("AirBagLocSide").includes("1st Row"))
    features.push("Front side-impact airbags");
  if (s("AirBagLocCurtain")) features.push("Side-curtain airbags");
  specs.features = features.slice(0, 12).join("\n");
  specs.vinDecoded = true;
  return stickerSpecsSchema.parse(specs);
}

export function parseEpaMenu(
  payload: unknown,
): { text: string; value: string }[] {
  const item = record(payload).menuItem;
  return (Array.isArray(item) ? item : item ? [item] : [])
    .map((v) => record(v))
    .map((r) => ({ text: value(r, "text"), value: value(r, "value") }))
    .filter((v) => v.text && v.value);
}

// EPA adds drivetrain/body qualifiers (e.g. "Fusion FWD", "F150 Pickup 2WD").
// Return candidates for staff to choose; never assume the first variant is right.
export function relatedEpaModel(candidate: string, model: string) {
  const a = normalizeName(candidate),
    b = normalizeName(model);
  return (
    a === b ||
    (a.startsWith(b) &&
      /^(awd|fwd|rwd|2wd|4wd|4x4|pickup|hybrid|plugin|wagon|sedan|coupe|convertible|cabriolet|sport|super|crew|extended|regular|ffv|diesel|electric)/.test(
        a.slice(b.length),
      ))
  );
}

export function parseEpaVehicle(
  payload: unknown,
  identity: Pick<SpecsIdentity, "year" | "make" | "model">,
  id: string,
): StickerSpecs {
  const r = record(payload),
    s = (key: string) => value(r, key);
  if (
    s("id") !== id ||
    s("year") !== String(identity.year) ||
    normalizeName(s("make")) !== normalizeName(identity.make) ||
    !relatedEpaModel(s("model"), identity.model)
  )
    throw new Error(
      "The fuel-economy record does not match this vehicle. Choose a matching configuration.",
    );
  const specs = emptyStickerSpecs();
  const fuel = s("fuelType1");
  // city08/highway08/comb08 refer to the primary fuel, including gasoline-only
  // operation for a plug-in hybrid. Never label those ratings as blended MPGe.
  if (/hydrogen|cng|natural gas/i.test(fuel))
    throw new Error(
      "This fuel type needs a separately verified economy label. Enter the ratings manually.",
    );
  specs.cityMpg = positive(s("city08")) ? s("city08") : "";
  specs.highwayMpg = positive(s("highway08")) ? s("highway08") : "";
  specs.combinedMpg = positive(s("comb08")) ? s("comb08") : "";
  if (!specs.cityMpg && !specs.highwayMpg && !specs.combinedMpg)
    throw new Error("EPA has no fuel-economy ratings for this configuration.");
  specs.economyUnit = /electricity/i.test(fuel) ? "MPGe" : "MPG";
  specs.economyFuel =
    /plug-in/i.test(s("atvType")) && !/electricity/i.test(fuel)
      ? `${fuel} only`
      : fuel;
  specs.epaId = id;
  specs.epaLabel = `${s("year")} ${s("make")} ${s("model")} · ${s("trany")} · ${s("displ") ? `${s("displ")}L` : fuel}`;
  specs.transmission = s("trany");
  specs.drivetrain = s("drive");
  specs.fuel = fuel;
  specs.engine = [
    s("displ") ? `${s("displ")}L` : "",
    positive(s("cylinders"))
      ? `${s("cylinders")}-cylinder`
      : /electricity/i.test(fuel)
        ? "Electric"
        : "",
  ]
    .filter(Boolean)
    .join(" ");
  return stickerSpecsSchema.parse(specs);
}

export function mergeVinSpecs(
  current: StickerSpecs,
  incoming: StickerSpecs,
): StickerSpecs {
  const next = { ...current };
  for (const key of [
    "engine",
    "horsepower",
    "transmission",
    "drivetrain",
    "fuel",
    "body",
  ] as const)
    if (!next[key]) next[key] = incoming[key];
  const existing = current.features
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const additions = incoming.features
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !existing.includes(s));
  next.features = [
    ...existing,
    ...additions.slice(0, Math.max(0, 12 - existing.length)),
  ].join("\n");
  next.vinDecoded = current.vinDecoded || incoming.vinDecoded;
  return next;
}

export type EpaImportedFields = Partial<
  Pick<StickerSpecs, "engine" | "transmission" | "drivetrain" | "fuel">
>;
export function selectEpaSpecs(
  current: StickerSpecs,
  selected: StickerSpecs,
  previous: EpaImportedFields = {},
) {
  const next = { ...current };
  const imported: EpaImportedFields = {};
  for (const key of ["engine", "transmission", "drivetrain", "fuel"] as const) {
    // Replace fields filled by the prior EPA selection, but preserve VIN data
    // and staff edits when correcting a previously chosen configuration.
    if (!current[key] || (key in previous && current[key] === previous[key])) {
      next[key] = selected[key];
      imported[key] = selected[key];
    }
  }
  for (const key of [
    "cityMpg",
    "highwayMpg",
    "combinedMpg",
    "economyFuel",
    "epaId",
    "epaLabel",
  ] as const)
    next[key] = selected[key];
  next.economyUnit = selected.economyUnit;
  return { specs: next, imported };
}
