import {
  emptyStickerSpecs,
  normalizeName,
  parseEpaMenu,
  parseEpaVehicle,
  parseStickerVin,
  relatedEpaModel,
  type EpaOption,
  type SpecsIdentity,
  type SpecsLookup,
} from "./vehicle-specifications";

type FetchJson = (url: string) => Promise<unknown>;
const getJson: FetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error("Vehicle data is temporarily unavailable.");
  return response.json();
};
const epaUrl = (path: string, params?: Record<string, string>) =>
  `https://www.fueleconomy.gov/ws/rest/vehicle/${path}${params ? `?${new URLSearchParams(params)}` : ""}`;

async function epaOptions(
  identity: SpecsIdentity,
  json: FetchJson,
): Promise<EpaOption[]> {
  const year = String(identity.year);
  const makes = parseEpaMenu(await json(epaUrl("menu/make", { year })));
  const make = makes.find(
    (m) => normalizeName(m.value) === normalizeName(identity.make),
  )?.value;
  if (!make) return [];
  const models = parseEpaMenu(await json(epaUrl("menu/model", { year, make })));
  const candidates = models.filter((m) =>
    relatedEpaModel(m.value, identity.model),
  );
  if (candidates.length > 10)
    throw new Error("Too many configurations to match automatically.");
  const groups = await Promise.all(
    candidates.map(async (model) =>
      parseEpaMenu(
        await json(epaUrl("menu/options", { year, make, model: model.value })),
      )
        .filter((item) => /^\d{1,6}$/.test(item.value))
        .map((item) => ({
          id: item.value,
          model: model.value,
          label: `${model.text} · ${item.text}`,
        })),
    ),
  );
  return groups.flat();
}

export async function lookupStickerSpecs(
  identity: SpecsIdentity,
  json: FetchJson = getJson,
): Promise<SpecsLookup> {
  const [vin, epa] = await Promise.allSettled([
    json(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(identity.vin)}?format=json&modelyear=${identity.year}`,
    ).then((data) => parseStickerVin(data, identity)),
    epaOptions(identity, json),
  ]);
  const warnings: string[] = [];
  if (vin.status === "rejected")
    warnings.push(
      vin.reason instanceof Error && /VIN|NHTSA/.test(vin.reason.message)
        ? vin.reason.message
        : "VIN specifications are unavailable right now. Retry or enter confirmed details below.",
    );
  if (epa.status === "rejected")
    warnings.push(
      "Fuel-economy lookup is unavailable right now. Retry or enter verified ratings below.",
    );
  else if (!epa.value.length)
    warnings.push(
      "No matching EPA configurations were found. You can enter verified fuel-economy ratings below.",
    );
  return {
    specs: vin.status === "fulfilled" ? vin.value : emptyStickerSpecs(),
    options: epa.status === "fulfilled" ? epa.value : [],
    warnings,
  };
}

export async function lookupEpaVehicle(
  identity: SpecsIdentity,
  id: string,
  json: FetchJson = getJson,
) {
  if (!/^\d{1,6}$/.test(id))
    throw new Error("Choose a valid EPA configuration.");
  return parseEpaVehicle(await json(epaUrl(id)), identity, id);
}
