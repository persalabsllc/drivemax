import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PrintScaling, Duplex } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { demoInventory } from "../lib/demo-vehicles";
import {
  defaultPrintMaterials,
  printMaterialsSchema,
  printVehicleSchema,
  stickerTotal,
} from "../lib/inventory-print";
import { buildInventoryPrintPdf } from "../lib/inventory-print-pdf";
import { emptyStickerSpecs } from "../lib/vehicle-specifications";

const vehicle = demoInventory("private-org-id", "2026-10-26")[0];
const defaults = () => defaultPrintMaterials(vehicle);
const assets = (asset: string) =>
  fs.readFile(path.join(process.cwd(), "public", asset));
async function inspect(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const task = getDocument({
    data: Uint8Array.from(bytes),
    standardFontDataUrl: path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/standard_fonts/",
    ),
  });
  const rendered = await task.promise;
  const text: string[] = [];
  try {
    for (let page = 1; page <= rendered.numPages; page++) {
      const content = await (await rendered.getPage(page)).getTextContent();
      text.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
  } finally {
    await task.destroy();
  }
  for (const page of pdf.getPages())
    assert.deepEqual(page.getSize(), { width: 612, height: 792 });
  return { pdf, text };
}

test("inventory print defaults match the dealership's existing written warranty", async () => {
  const draft = defaults();
  const { text } = await inspect(
    await fs.readFile("assets/forms/Drive_Max_Limited_Powertrain_Warranty.pdf"),
  );
  assert.match(text.join(" "), /14\s+DAYS\s+OR\s+500\s+MILES/i);
  assert.match(text.join(" "), /100%/);
  assert.match(text.join(" "), /no deductible/i);
  assert.equal(draft.warranty, "dealer");
  assert.equal(draft.warrantyType, "limited");
  assert.equal(draft.serviceContract, true);
  assert.equal(draft.parts, "100");
  assert.equal(draft.labor, "100");
  assert.match(draft.duration, /14 days or 500 miles/);
  assert.match(draft.systems, /Engine: internally lubricated/);
  assert.match(draft.systems, /Transmission: internally lubricated/);
});

test("window sticker is one portrait page with public details and an itemized asking price", async () => {
  const { pdf, text } = await inspect(
    await buildInventoryPrintPdf(
      vehicle,
      { ...defaults(), buyersGuide: false },
      assets,
    ),
  );
  assert.equal(pdf.getPageCount(), 1);
  assert.match(text[0], /1HGCM82633A004352/);
  assert.match(text[0], /121,400 miles/);
  assert.match(text[0], /Silver/);
  assert.match(text[0], /\$6,394\.00/);
  assert.match(text[0], /\$5,995\.00/);
  assert.match(text[0], /administration fee \$399\.00/);
  assert.match(text[0], /6210 Old US Hwy 70 W/);
  assert.doesNotMatch(
    text[0],
    /3,000|450\.00|private-org-id|Reconditioning|Acquisition/i,
  );
  assert.equal(
    pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(),
    PrintScaling.None,
  );
  assert.equal(
    pdf.catalog.getOrCreateViewerPreferences().getDuplex(),
    Duplex.Simplex,
  );
  assert.equal(stickerTotal(12345.67, 399), 12744.67);
  assert.equal("cost" in printVehicleSchema.parse(vehicle), false);
});

test("Buyers Guide preserves the official front and reverse with dealer terms in their blanks", async () => {
  const { pdf, text } = await inspect(
    await buildInventoryPrintPdf(
      vehicle,
      { ...defaults(), sticker: false },
      assets,
    ),
  );
  assert.equal(pdf.getPageCount(), 2);
  assert.match(text[0], /BUYERS GUIDE/);
  assert.match(text[0], /14 days or 500 miles after delivery/);
  assert.match(text[0], /Mechanical failure only\. No deductible/);
  assert.match(text[1], /major defects/);
  assert.match(text[1], /Drive Max Used Cars LLC/);
  assert.match(text[1], /General Manager \| \(252\) 541-0040/);
  assert.doesNotMatch(text.join(" "), /\$5,995|\$6,394/);
  assert.equal(
    pdf.catalog.getOrCreateViewerPreferences().getDuplex(),
    Duplex.DuplexFlipLongEdge,
  );
});

test("window sticker prints sourced equipment and fuel economy without mislabeling edited ratings", async () => {
  const specifications = {
    ...emptyStickerSpecs(),
    engine: "3.0L V6",
    horsepower: "221",
    transmission: "Automatic 6-spd",
    drivetrain: "Front-Wheel Drive",
    fuel: "Gasoline",
    body: "Sedan",
    features: "Tire pressure monitoring\nFront side-impact airbags",
    cityMpg: "18",
    highwayMpg: "26",
    combinedMpg: "21",
    epaId: "25490",
    epaLabel: "2009 Ford Fusion FWD",
    economyFuel: "Regular Gasoline",
    vinDecoded: true,
  };
  const { text, pdf } = await inspect(
    await buildInventoryPrintPdf(
      vehicle,
      { ...defaults(), buyersGuide: false, specifications },
      assets,
    ),
  );
  assert.equal(pdf.getPageCount(), 1);
  for (const expected of [
    "VEHICLE SPECIFICATIONS",
    "221 hp",
    "3.0L V6",
    "EPA FUEL ECONOMY",
    "Tire pressure monitoring",
    "Front side-impact airbags",
    "FuelEconomy.gov #25490",
    "Actual mileage will vary.",
  ])
    assert.ok(text[0].includes(expected), expected);
  const manual = await inspect(
    await buildInventoryPrintPdf(
      vehicle,
      {
        ...defaults(),
        buyersGuide: false,
        specifications: {
          ...specifications,
          epaId: "",
          epaLabel: "",
          economyUnit: "MPGe",
          economyFuel: "Electricity",
          cityMpg: "120",
          highwayMpg: "105",
          combinedMpg: "112",
        },
      },
      assets,
    ),
  );
  assert.match(manual.text[0], /MPGe/);
  assert.match(manual.text[0], /Economy: dealer-provided/);
  assert.doesNotMatch(manual.text[0], /EPA FUEL ECONOMY|FuelEconomy.gov/);
});

test("combined duplex packet keeps the sticker separate from the two-sided Buyers Guide", async () => {
  const { pdf, text } = await inspect(
    await buildInventoryPrintPdf(vehicle, defaults(), assets),
  );
  assert.equal(pdf.getPageCount(), 4);
  assert.match(text[0], /TOTAL ASKING PRICE/);
  assert.equal(text[1], "");
  assert.match(text[2], /BUYERS GUIDE/);
  assert.match(text[3], /FOR COMPLAINTS AFTER SALE/);
});

test("edited terms and dealer contact print without changing the inventory or defaults", async () => {
  const original = structuredClone(vehicle);
  const draft = {
    ...defaults(),
    sticker: false,
    labor: "50",
    parts: "75",
    duration: "30 days or 1,000 miles, whichever occurs first.",
    systems:
      "Engine: internally lubricated moving components.\n$100 deductible per covered repair.",
    complaintsContact: "Service Manager",
    serviceContract: false,
  };
  const { text } = await inspect(
    await buildInventoryPrintPdf(vehicle, draft, assets),
  );
  assert.match(text[0], /30 days or 1,000 miles/);
  assert.match(text[0], /\$100 deductible/);
  assert.match(text[0], /50/);
  assert.match(text[0], /75/);
  assert.match(text[1], /Service Manager/);
  assert.deepEqual(vehicle, original);
  assert.equal(defaults().labor, "100");
});

test("as-is and implied-only modes omit dealer warranty terms and choose the correct official front", async () => {
  for (const warranty of ["as_is", "implied"] as const) {
    const { text } = await inspect(
      await buildInventoryPrintPdf(
        vehicle,
        { ...defaults(), sticker: false, warranty },
        assets,
      ),
    );
    assert.match(
      text[0],
      warranty === "implied" ? /IMPLIED WARRANTIES ONLY/ : /AS IS/,
    );
    assert.doesNotMatch(
      text[0],
      /14 days or 500 miles|Mechanical failure only/,
    );
    assert.equal(text.length, 2);
  }
});

test("invalid print settings and text that cannot fit are rejected rather than silently clipped", async () => {
  for (const edit of [
    { sticker: false, buyersGuide: false },
    { price: "" },
    { price: "-1" },
    { labor: "101" },
    { systems: "" },
    { duration: "" },
  ])
    assert.equal(
      printMaterialsSchema.safeParse({ ...defaults(), ...edit }).success,
      false,
    );
  await assert.rejects(
    buildInventoryPrintPdf(
      vehicle,
      { ...defaults(), sticker: false, systems: "W".repeat(600) },
      assets,
    ),
    /Covered systems is too long to fit legibly/,
  );
  await assert.rejects(
    buildInventoryPrintPdf(
      vehicle,
      { ...defaults(), highlights: "Unsupported 🚗" },
      assets,
    ),
    /character this print font cannot display/,
  );
});
