import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeVpic,
  mergeDecodedFields,
  mergeFeatureLines,
  normalizeVin,
  parseSafetyRatings,
  safetyVariants,
  VIN_PATTERN,
} from "../lib/vehicle-data";
import { leadSchema } from "../lib/inventory";
import {
  leadLabel,
  purchaseOfferDraft,
  purchaseSummary,
} from "../lib/purchase-requests";

const vin = "1HGCM82633A004352";
// Representative fields from the public vPIC response for NHTSA's example VIN.
const row = {
  ModelYear: "2003",
  Make: "HONDA",
  Model: "Accord",
  Trim: "EX-V6",
  ErrorCode: "0",
  EngineHP: "240",
  EngineCylinders: "6",
  DisplacementL: "2.998832712",
  TransmissionStyle: "Automatic",
  TransmissionSpeeds: "5",
  BodyClass: "Coupe",
};
test("VIN decoding uses reported values, normalizes pasted VINs, and rejects invalid responses", () => {
  assert.equal(normalizeVin(` ${vin.toLowerCase()}\n`), vin);
  assert.equal(VIN_PATTERN.test("1HGCM82633A00435I"), false);
  const decoded = decodeVpic({ Results: [row] }, vin);
  assert.equal(decoded.fields.year, "2003");
  assert.equal(decoded.fields.make, "HONDA");
  assert.equal(decoded.fields.model, "Accord");
  assert.ok(
    decoded.features.includes("240 horsepower (manufacturer reported)"),
  );
  assert.ok(decoded.features.includes("3.0L 6-cylinder engine"));
  assert.equal(decoded.warning, "");
  assert.throws(
    () => decodeVpic({ Results: [{ ...row, ErrorCode: "1, 5" }] }, vin),
    /could not verify/,
  );
  assert.throws(() => decodeVpic({ Results: [] }, vin), /no vehicle details/);
});
test("missing horsepower and optional equipment are not invented", () => {
  const decoded = decodeVpic(
    {
      Results: [
        {
          ...row,
          EngineHP: "",
          ErrorCode: "14",
          ABS: "Standard",
          BlindSpotMon: "Optional",
          LaneKeepSystem: "Not Applicable",
        },
      ],
    },
    vin,
  );
  assert.equal(
    decoded.features.some((f) => f.includes("horsepower")),
    false,
  );
  assert.ok(decoded.features.includes("Anti-lock brakes"));
  assert.equal(decoded.features.includes("Blind spot warning"), false);
  assert.equal(decoded.features.includes("Lane keeping assistance"), false);
  assert.match(decoded.warning, /unavailable/);
});
test("a new VIN replaces previous imports, clears absent imported fields, and preserves manual edits", () => {
  const previous = {
    year: "2003",
    make: "HONDA",
    model: "Accord",
    trim: "EX-V6",
  };
  const current = { ...previous, make: "Honda (reviewed)", body_style: "" };
  const next = mergeDecodedFields(
    current,
    { year: "2020", make: "TOYOTA", model: "Camry", body_style: "Sedan" },
    previous,
  );
  assert.deepEqual(next, {
    year: "2020",
    make: "Honda (reviewed)",
    model: "Camry",
    trim: "",
    body_style: "Sedan",
  });
  assert.equal(
    mergeFeatureLines(
      "Heated seats\n240 horsepower\nBackup camera",
      ["240 horsepower"],
      ["backup camera", "180 horsepower"],
    ),
    "Heated seats\nBackup camera\n180 horsepower",
  );
});
test("safety ratings require the selected variant and omit unrated or invalid stars", () => {
  const variants = safetyVariants({
    Results: [
      { VehicleId: 7731, VehicleDescription: "2013 Acura RDX SUV 4WD" },
      { VehicleId: 7520, VehicleDescription: "2013 Acura RDX SUV FWD" },
    ],
  });
  assert.equal(variants.length, 2);
  const response = {
    Results: [
      {
        VehicleId: 7520,
        OverallRating: "5",
        OverallFrontCrashRating: "Not Rated",
        OverallSideCrashRating: "0",
        RolloverRating: "4",
      },
    ],
  };
  const ratings = parseSafetyRatings(response, variants[1]);
  assert.deepEqual(ratings.ratings, [
    { label: "Overall", stars: 5 },
    { label: "Rollover", stars: 4 },
  ]);
  assert.ok(ratings.features[0].includes("FWD"));
  assert.throws(
    () => parseSafetyRatings(response, variants[0]),
    /not returned/,
  );
  assert.deepEqual(
    parseSafetyRatings(
      { Results: [{ VehicleId: 7520, OverallRating: "Not Rated" }] },
      variants[1],
    ).features,
    [],
  );
});

const purchase = {
  requestId: "0e400b44-3e80-4d19-a9f4-4e283be977d6",
  kind: "vehicle",
  purpose: "purchase-offer",
  name: "Test Seller",
  email: "seller@example.com",
  preferredContact: "Email",
  sellerVin: vin,
  sellerYear: "2003",
  sellerMake: "Honda",
  sellerModel: "Accord",
  sellerMiles: "85000",
  condition: "Good",
  titleStatus: "Clean title",
  sellerZip: "28562",
  askingPrice: "4500.50",
  message: "Recent tires; one scratch on the rear bumper.",
};
test("purchase intake requires usable vehicle details and the selected contact method", () => {
  assert.equal(leadSchema.safeParse(purchase).success, true);
  assert.equal(
    leadSchema.safeParse({ ...purchase, sellerMiles: "0", askingPrice: "" })
      .success,
    true,
  );
  for (const patch of [
    { sellerVin: "invalid" },
    { sellerMiles: "" },
    { sellerMiles: "-1" },
    { sellerMiles: "2.5" },
    { sellerMiles: "2000001" },
    { sellerYear: "1970" },
    { sellerMake: " " },
    { condition: undefined },
    { titleStatus: undefined },
    { sellerZip: "abc" },
    { askingPrice: "-10" },
    { askingPrice: "12.345" },
    { vehicleId: purchase.requestId },
    { kind: "finance" },
    { email: "" },
    { preferredContact: "Phone call" },
  ]) {
    assert.equal(
      leadSchema.safeParse({ ...purchase, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(
    leadSchema.safeParse({
      ...purchase,
      email: "",
      preferredContact: "Phone call",
      phone: "252-555-0100",
    }).success,
    true,
  );
});
test("purchase summaries and offer drafts retain the VIN, mileage, amount, and seller details", () => {
  const summary = purchaseSummary(purchase);
  assert.match(summary, /85,000/);
  assert.ok(summary.includes(vin));
  assert.ok(summary.includes(purchase.message));
  const lead = { name: purchase.name, kind: "vehicle", details: purchase };
  assert.equal(leadLabel(lead), "Purchase offer request");
  assert.match(purchaseOfferDraft(lead, "4000.50"), /\$4,000.50/);
  assert.match(purchaseOfferDraft(lead, 4000), /inspection/);
  for (const invalid of ["", "1e3", "-5", "12.333", NaN, Infinity, 2000001])
    assert.equal(purchaseOfferDraft(lead, invalid), "");
});
