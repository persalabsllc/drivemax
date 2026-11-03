import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFDict, PDFName, PrintScaling, Duplex } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { demoInventory } from "../lib/demo-vehicles";
import {
  defaultPrintMaterials,
  printMaterialsSchema,
  printVehicleSchema,
  stickerTotal,
  printMaterialsFilename,
  printMaterialsInstructions,
} from "../lib/inventory-print";
import { buildInventoryPrintPdf } from "../lib/inventory-print-pdf";
import { emptyStickerSpecs } from "../lib/vehicle-specifications";
import { inventoryTitleValues } from "../lib/inventory-title-pdf";
import { defaultInventoryTitle } from "../lib/inventory-title";
import { soldForms, formValues } from "../lib/documents";

const vehicle = demoInventory("private-org-id", "2026-10-26")[0];
const defaults = () => defaultPrintMaterials(vehicle);
const assets = (asset: string) =>
  fs.readFile(
    asset === "/api/forms/MVR-1"
      ? path.join(process.cwd(), "assets/forms/MVR-1.pdf")
      : path.join(process.cwd(), "public", asset),
  );
async function inspect(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  // Inspect printed text using a temporary flattened copy. Keep the returned
  // original intact so tests can verify its native editable fields as well.
  const printCopy = await PDFDocument.load(bytes);
  if (printCopy.getForm().getFields().length) printCopy.getForm().flatten();
  const task = getDocument({
    data: Uint8Array.from(await printCopy.save()),
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

test("inventory title-only application prints the dealership as owner without a sale or asking price", async () => {
  const original = structuredClone(vehicle);
  const draft = {
    ...defaultPrintMaterials({ ...vehicle, price: 0 }),
    sticker: false,
    buyersGuide: false,
    titleApplication: true,
  };
  const loaded: string[] = [];
  const { pdf, text } = await inspect(
    await buildInventoryPrintPdf(vehicle, draft, async (asset) => {
      loaded.push(asset);
      return assets(asset);
    }),
  );
  assert.deepEqual(loaded, ["/api/forms/MVR-1"]);
  assert.equal(pdf.getPageCount(), 1);
  for (const expected of [
    "MVR-1",
    "04/26",
    "DRIVE MAX USED CARS LLC",
    "6210 Old US Hwy 70 W",
    "New Bern",
    "28562",
    "Craven",
    vehicle.vin,
    "121400",
    "10/14/2026",
  ])
    assert.ok(text[0].includes(expected), expected);
  assert.doesNotMatch(
    text[0],
    /5995|5,995|3,000|private-org-id|General Manager/,
  );
  await assertEditableTitle(pdf);
  assert.equal(
    pdf.catalog.getOrCreateViewerPreferences().getDuplex(),
    Duplex.Simplex,
  );
  assert.equal(
    printMaterialsFilename(vehicle, draft),
    "drive-max-DM-101-title-only-application.pdf",
  );
  assert.match(
    printMaterialsInstructions(draft),
    /1-page title-only application.*one-sided/,
  );
  assert.deepEqual(vehicle, original);
});

test("inventory title fields select title only and keep registration, seller, signatures and unknown facts blank", () => {
  const title = defaultInventoryTitle(vehicle);
  const mapped = inventoryTitleValues(vehicle, title);
  const template = soldForms.find((form) => form.id === "MVR-1")!;
  const fields = formValues(template, mapped.context, mapped.paperwork);
  const checked = Object.entries(fields)
    .filter(([, value]) => value === true)
    .map(([name]) => name);
  assert.deepEqual(
    checked.sort(),
    [
      "Check Box Title Only - Vehicle Not in Operation",
      "CheckBox Vehicle Purchased Used",
    ].sort(),
  );
  for (const name of [
    "Enter Owner 1 ID Number",
    "Enter Full Legal Name of Owner 2 to include First, Middle, Last, Suffix or Company 2 Name",
    "Enter Name and Address From Whom you Purchased the Vehicle",
    "Enter NC Dealer Number if applicable",
    "Enter Plate Number Transferred",
    "Enter Name of Insurance Company authorized in NC",
    "Enter 1st Lienholder Name",
  ])
    assert.equal(fields[name], "", name);
  assert.ok(
    Object.keys(fields).every(
      (name) => !/signature|initial|notary|notariz/i.test(name),
    ),
  );
});

test("inventory title review supports seller details, updated mileage and both liens without changing inventory", async () => {
  const title = {
    ...defaultInventoryTitle(vehicle),
    ownerId: "TEST-ID",
    mileage: "122345",
    body: "Sedan",
    fuel: "Gas",
    purchasedFrom: "Sample Seller\n123 Example Rd, Raleigh, NC 27601",
    sellerDealerNumber: "TEST-123",
    leased: "no" as const,
  };
  title.liens[0] = {
    name: "First Sample Lender",
    address: "1 Test St",
    city: "Raleigh",
    state: "nc",
    zip: "27601",
    id: "TEST-L1",
    account: "TEST-ACCOUNT-1",
    date: "2026-10-12",
  };
  title.liens[1] = {
    ...title.liens[0],
    name: "Second Sample Lender",
    id: "TEST-L2",
    account: "TEST-ACCOUNT-2",
  };
  const { text } = await inspect(
    await buildInventoryPrintPdf(
      vehicle,
      {
        ...defaults(),
        sticker: false,
        buyersGuide: false,
        titleApplication: true,
        titleDetails: title,
      },
      assets,
    ),
  );
  for (const expected of [
    "TEST-ID",
    "122345",
    "Sedan",
    "Sample Seller",
    "TEST-123",
    "First Sample Lender",
    "Second Sample Lender",
    "TEST-ACCOUNT-1",
    "TEST-ACCOUNT-2",
    "10/12/2026",
  ])
    assert.ok(text[0].includes(expected), expected);
  assert.equal(vehicle.mileage, 121400);
  assert.equal(defaultInventoryTitle(vehicle).purchasedFrom, "");
});

test("title application stays on a separate sheet for every print-material combination", async () => {
  for (const [sticker, buyersGuide, count] of [
    [false, true, 3],
    [true, false, 2],
    [true, true, 5],
  ] as const) {
    const draft = {
      ...defaults(),
      sticker,
      buyersGuide,
      titleApplication: true,
    };
    const { pdf, text } = await inspect(
      await buildInventoryPrintPdf(vehicle, draft, assets),
    );
    assert.equal(pdf.getPageCount(), count);
    assert.match(text.at(-1)!, /TITLE APPLICATION/);
    await assertEditableTitle(pdf);
    if (buyersGuide)
      assert.equal(
        (count - 1) % 2,
        0,
        "title begins on a front side in duplex mode",
      );
    assert.equal(
      printMaterialsFilename(vehicle, draft),
      "drive-max-DM-101-print-materials.pdf",
    );
    assert.match(
      printMaterialsInstructions(draft),
      new RegExp(`${count}-page`),
    );
  }
});

async function assertEditableTitle(pdf: PDFDocument) {
  const template = await PDFDocument.load(await assets("/api/forms/MVR-1"));
  const form = pdf.getForm();
  assert.deepEqual(
    form
      .getFields()
      .map((field) => field.getName())
      .sort(),
    template
      .getForm()
      .getFields()
      .map((field) => field.getName())
      .sort(),
    "all original fields must survive in the canonical AcroForm tree",
  );
  const titlePage = pdf.getPages().at(-1)!;
  const widgets = new Set(
    titlePage.node
      .Annots()!
      .asArray()
      .map((ref) => pdf.context.lookup(ref)),
  );
  for (const field of form.getFields()) {
    assert.equal(field.isReadOnly(), false, field.getName());
    const fontName = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(
      field.acroField.getDefaultAppearance() ?? "",
    )?.[1];
    if (fontName === "Helvetica") {
      const fonts = field.acroField.dict
        .lookup(PDFName.of("DR"), PDFDict)
        .lookup(PDFName.of("Font"), PDFDict);
      assert.ok(
        fonts.has(PDFName.of(fontName)),
        "manual edits can resolve their font",
      );
    }
    for (const widget of field.acroField.getWidgets()) {
      assert.ok(widgets.has(widget.dict), field.getName());
      assert.equal(
        widget.dict.get(PDFName.of("P"))?.toString(),
        titlePage.ref.toString(),
        "widgets remain attached to the title page",
      );
      if (field.acroField.dict.get(PDFName.of("FT"))?.toString() !== "/Sig")
        assert.ok(
          widget.getAppearances()?.normal,
          `${field.getName()} has an appearance`,
        );
    }
  }
  assert.equal(form.getTextField("Enter ODOMETER READING").getText(), "121400");
  assert.equal(
    form.getTextField("Enter VEHICLE IDENTIFICATION NUMBER").getText(),
    vehicle.vin,
  );
  assert.equal(
    form
      .getCheckBox("Check Box Title Only - Vehicle Not in Operation")
      .isChecked(),
    true,
  );
  assert.equal(
    form.getCheckBox("CheckBox Vehicle Purchased Used").isChecked(),
    true,
  );
  assert.ok(
    pdf
      .getPages()
      .slice(0, -1)
      .every((page) => !page.node.Annots()?.size()),
    "sticker and Guide stay static",
  );
}

test("manual PDF edits survive save/reopen and print in standalone and combined title packets", async () => {
  for (const combined of [false, true]) {
    const bytes = await buildInventoryPrintPdf(
      vehicle,
      {
        ...defaults(),
        sticker: combined,
        buyersGuide: combined,
        titleApplication: true,
      },
      assets,
    );
    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm();
    const ownerName =
      "Enter Full Legal Name of Owner 1 to include First, Middle, Last, Suffix or Company 1 Name";
    form.getTextField(ownerName).setText("DRIVE MAX USED CARS LLC - UPDATED");
    form.getTextField("Enter ODOMETER READING").setText("123456");
    form.getTextField("Enter Owner 1 ID Number").setText("TEST-OWNER-ID");
    form
      .getCheckBox("Check Box Title Only - Vehicle Not in Operation")
      .uncheck();
    form
      .getCheckBox(
        "Check Box Title and License Plate to include Class of License",
      )
      .check();
    const { pdf: reopened, text } = await inspect(await pdf.save());
    assert.equal(reopened.getPageCount(), combined ? 5 : 1);
    const saved = reopened.getForm();
    assert.equal(
      saved.getTextField(ownerName).getText(),
      "DRIVE MAX USED CARS LLC - UPDATED",
    );
    assert.equal(
      saved.getTextField("Enter ODOMETER READING").getText(),
      "123456",
    );
    assert.equal(
      saved.getTextField("Enter Owner 1 ID Number").getText(),
      "TEST-OWNER-ID",
    );
    assert.equal(
      saved
        .getCheckBox("Check Box Title Only - Vehicle Not in Operation")
        .isChecked(),
      false,
    );
    assert.equal(
      saved
        .getCheckBox(
          "Check Box Title and License Plate to include Class of License",
        )
        .isChecked(),
      true,
    );
    assert.match(text.at(-1)!, /DRIVE MAX USED CARS LLC - UPDATED/);
    assert.match(text.at(-1)!, /123456/);
    assert.match(text.at(-1)!, /TEST-OWNER-ID/);
  }
});

test("title review validates dates, owner details and whole-number mileage only when selected", () => {
  for (const edit of [
    { purchaseDate: "2026-02-30" },
    { mileage: "-1" },
    { mileage: "12.5" },
    { ownerName: "" },
    { state: "North Carolina" },
  ]) {
    const titleDetails = { ...defaultInventoryTitle(vehicle), ...edit };
    assert.equal(
      printMaterialsSchema.safeParse({
        ...defaults(),
        titleApplication: true,
        titleDetails,
      }).success,
      false,
    );
    assert.equal(
      printMaterialsSchema.safeParse({
        ...defaults(),
        titleApplication: false,
        titleDetails,
      }).success,
      true,
    );
  }
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
