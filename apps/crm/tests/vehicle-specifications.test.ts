import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyStickerSpecs,
  mergeVinSpecs,
  parseEpaMenu,
  parseEpaVehicle,
  parseStickerVin,
  relatedEpaModel,
  stickerSpecsSchema,
  selectEpaSpecs,
} from "../lib/vehicle-specifications";
import {
  lookupEpaVehicle,
  lookupStickerSpecs,
} from "../lib/vehicle-specifications-service";

const identity = {
  vin: "3FAHP08199R161851",
  year: 2009,
  make: "FORD",
  model: "Fusion",
};
const vinRow = {
  VIN: identity.vin,
  ModelYear: "2009",
  Make: "FORD",
  Model: "Fusion",
  ErrorCode: "0",
  DisplacementL: "3.0",
  EngineConfiguration: "V-Shaped",
  EngineCylinders: "6",
  EngineHP: "221",
  DriveType: "FWD/Front-Wheel Drive",
  FuelTypePrimary: "Gasoline",
  BodyClass: "Sedan/Saloon",
  Doors: "4",
  TPMS: "Direct",
  AirBagLocFront: "1st Row (Driver and Passenger)",
  BackupCamera: "Optional",
  ABS: "",
  ESC: "Standard",
};
const epaRow = {
  id: "25490",
  year: "2009",
  make: "Ford",
  model: "Fusion FWD",
  trany: "Automatic 6-spd",
  displ: "3.0",
  cylinders: "6",
  drive: "Front-Wheel Drive",
  fuelType1: "Regular Gasoline",
  city08: "18",
  highway08: "26",
  comb08: "21",
};

test("VIN imports reported specifications and standard equipment without inventing missing or optional features", () => {
  const specs = parseStickerVin({ Results: [vinRow] }, identity);
  assert.equal(specs.engine, "3.0L V6");
  assert.equal(specs.horsepower, "221");
  assert.equal(specs.drivetrain, "Front-Wheel Drive");
  assert.equal(specs.transmission, "");
  assert.match(specs.features, /Electronic stability control/);
  assert.match(specs.features, /Tire pressure monitoring/);
  assert.doesNotMatch(specs.features, /camera|Anti-lock/i);
  assert.equal(specs.cityMpg, "");
});

test("flagged VINs, empty payloads and a mismatched saved identity are rejected", () => {
  assert.throws(() => parseStickerVin(null, identity), /does not match/);
  assert.throws(
    () =>
      parseStickerVin(
        { Results: [{ ...vinRow, ModelYear: "2010" }] },
        identity,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      parseStickerVin(
        { Results: [{ ...vinRow, ErrorCode: "0, 5" }] },
        identity,
      ),
    /flagged/,
  );
});

test("EPA matches drivetrain variants without treating similarly prefixed models as equivalent", () => {
  assert.equal(relatedEpaModel("Fusion FWD", "Fusion"), true);
  assert.equal(relatedEpaModel("F150 Pickup 4WD", "F-150"), true);
  assert.equal(relatedEpaModel("CX-50", "CX-5"), false);
  assert.equal(relatedEpaModel("F1500", "F150"), false);
  assert.deepEqual(parseEpaMenu(null), []);
  assert.deepEqual(
    parseEpaMenu({ menuItem: { text: "Ford", value: "Ford" } }),
    [{ text: "Ford", value: "Ford" }],
  );
});

test("EPA ratings retain source, correct units and primary-fuel mode; missing ratings do not become zeros", () => {
  const mpg = parseEpaVehicle(epaRow, identity, "25490");
  assert.equal(mpg.cityMpg, "18");
  assert.equal(mpg.combinedMpg, "21");
  assert.equal(mpg.epaId, "25490");
  assert.equal(mpg.economyUnit, "MPG");
  const ev = parseEpaVehicle(
    {
      ...epaRow,
      fuelType1: "Electricity",
      city08: "120",
      highway08: "0",
      comb08: "110",
    },
    identity,
    "25490",
  );
  assert.equal(ev.economyUnit, "MPGe");
  assert.equal(ev.highwayMpg, "");
  const phev = parseEpaVehicle(
    { ...epaRow, atvType: "Plug-in Hybrid" },
    identity,
    "25490",
  );
  assert.equal(phev.economyFuel, "Regular Gasoline only");
  assert.equal(phev.economyUnit, "MPG");
  assert.throws(
    () => parseEpaVehicle({ ...epaRow, make: "Toyota" }, identity, "25490"),
    /does not match/,
  );
  assert.throws(
    () => parseEpaVehicle({ ...epaRow, id: "30000" }, identity, "25490"),
    /does not match/,
  );
  assert.throws(
    () =>
      parseEpaVehicle(
        { ...epaRow, city08: "0", highway08: "0", comb08: "0" },
        identity,
        "25490",
      ),
    /no fuel-economy/,
  );
});

test("auto-fill preserves staff edits and never silently removes existing equipment", () => {
  const current = {
    ...emptyStickerSpecs(),
    engine: "Verified engine",
    features: "Leather seats",
  };
  const incoming = parseStickerVin({ Results: [vinRow] }, identity);
  const result = mergeVinSpecs(current, incoming);
  assert.equal(result.engine, "Verified engine");
  assert.equal(result.horsepower, "221");
  assert.match(result.features, /^Leather seats\n/);
  assert.deepEqual(mergeVinSpecs(result, incoming), result);
  const crowded = {
    ...current,
    features: Array.from({ length: 13 }, (_, i) => `User line ${i}`).join("\n"),
  };
  assert.equal(mergeVinSpecs(crowded, incoming).features, crowded.features);
  assert.equal(stickerSpecsSchema.safeParse(crowded).success, false);
  for (const cityMpg of ["-1", "0", "NaN", "501", "1e2"])
    assert.equal(
      stickerSpecsSchema.safeParse({ ...current, cityMpg }).success,
      false,
    );
});

test("changing the EPA configuration refreshes its imported fields while preserving VIN data and staff edits", () => {
  const current = { ...emptyStickerSpecs(), engine: "VIN engine" };
  const first = selectEpaSpecs(
    current,
    parseEpaVehicle(epaRow, identity, "25490"),
  );
  assert.equal(first.specs.transmission, "Automatic 6-spd");
  assert.equal(first.specs.engine, "VIN engine");
  const selected = {
    ...parseEpaVehicle(epaRow, identity, "25490"),
    transmission: "Manual 5-spd",
    cityMpg: "19",
  };
  const changed = selectEpaSpecs(first.specs, selected, first.imported);
  assert.equal(changed.specs.transmission, "Manual 5-spd");
  assert.equal(changed.specs.cityMpg, "19");
  assert.equal(changed.specs.engine, "VIN engine");
  const edited = selectEpaSpecs(
    { ...first.specs, transmission: "Verified transmission" },
    selected,
    first.imported,
  );
  assert.equal(edited.specs.transmission, "Verified transmission");
});

test("lookup returns configurations for explicit selection and tolerates one provider failing", async () => {
  const json = async (url: string) => {
    const u = new URL(url);
    if (u.hostname === "vpic.nhtsa.dot.gov") return { Results: [vinRow] };
    if (u.pathname.endsWith("menu/make"))
      return { menuItem: { text: "Ford", value: "Ford" } };
    if (u.pathname.endsWith("menu/model"))
      return {
        menuItem: [
          { text: "Fusion FWD", value: "Fusion FWD" },
          { text: "Mustang", value: "Mustang" },
        ],
      };
    if (u.pathname.endsWith("menu/options")) {
      assert.equal(u.searchParams.get("model"), "Fusion FWD");
      return { menuItem: { text: "Auto 6-spd, 6 cyl, 3.0 L", value: "25490" } };
    }
    throw new Error("Unexpected URL");
  };
  const result = await lookupStickerSpecs(identity, json);
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].id, "25490");
  assert.equal(result.specs.cityMpg, "");
  assert.deepEqual(result.warnings, []);
  const partial = await lookupStickerSpecs(identity, async (url) => {
    if (url.includes("fueleconomy.gov")) throw new Error("offline");
    return json(url);
  });
  assert.equal(partial.specs.horsepower, "221");
  assert.equal(partial.options.length, 0);
  assert.equal(partial.warnings.length, 1);
  const offline = await lookupStickerSpecs(identity, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(offline.specs, emptyStickerSpecs());
  assert.equal(offline.warnings.length, 2);
  await assert.rejects(
    lookupEpaVehicle(identity, "../secret", async () => {
      throw new Error("Must not fetch");
    }),
    /valid EPA/,
  );
});
