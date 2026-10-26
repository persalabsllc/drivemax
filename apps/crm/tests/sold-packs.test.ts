import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { demoWorkspace } from "../lib/demo";
import { blankPerson } from "../lib/people";
import {
  documentContext,
  formValues,
  soldPackForms,
  tradeForms,
  fieldKey,
} from "../lib/documents";
import { buildSoldPack } from "../lib/pdf-output";

test("sold packs include the correct pages with independent sold/trade VINs and buyer/seller fields", async () => {
  const without = soldPackForms("without-trade"),
    withTrade = soldPackForms("with-trade");
  assert.equal(without.length, 12);
  assert.equal(withTrade.length, 16);
  assert.ok(
    !without.some((f) => f.id === "payoff" || f.id.startsWith("trade-")),
  );
  assert.deepEqual(
    withTrade.slice(-3).map((f) => f.id),
    ["trade-MVR-180", "trade-MVR-181", "trade-MVR-63"],
  );
  assert.ok(
    without.some((f) => f.id === "MVR-180") &&
      without.some((f) => f.id === "MVR-181") &&
      without.some((f) => f.id === "MVR-63"),
  );
  const ws = demoWorkspace(),
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  c.name = "Sample Trade Owner";
  c.person = {
    ...blankPerson,
    first_name: "Sample",
    middle_name: "Trade",
    last_name: "Owner",
    address1: "100 Example Lane",
    city: "New Bern",
    state: "NC",
    zip: "28562",
  };
  o.status = "working";
  o.inventory_id = null;
  o.vehicle_details = {
    vin: "1HGCM82633A004352",
    year: 2003,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    mileage: 123456,
    color: "Silver",
    stock_number: "QA-1",
    cost: 3456,
    recon: 500,
    price: 10000,
    acquired_on: "2026-10-01",
  };
  o.trade = {
    vin: "1FMCU9G90EUA01234",
    year: 2014,
    make: "Ford",
    model: "Escape",
    trim: "SE",
    mileage: 98765,
    description: "2014 Ford Escape",
    allowance: 2000,
    acv: 1500,
    payoff: 1000,
  };
  ws.quotes = ws.quotes.filter((q) => q.opportunity_id !== o.id);
  const context = documentContext(ws, c, o);
  assert.equal(
    context["deal.salesperson"],
    ws.staff.find((s) => s.id === o.assigned_to)?.name,
  );
  assert.equal(
    context["dealer.representative"],
    undefined,
    "Salesperson assignment must not choose the attorney-in-fact",
  );
  const sold180 = withTrade.find((f) => f.id === "MVR-180")!,
    trade180 = tradeForms[0],
    trade181 = tradeForms[1],
    trade63 = tradeForms[2];
  assert.equal(
    formValues(sold180, context, {})["VEHICLE IDENTIFICATION NUMBER"],
    "1HGCM82633A004352",
  );
  const tradeVals = formValues(trade180, context, {});
  assert.equal(tradeVals["VEHICLE IDENTIFICATION NUMBER"], "1FMCU9G90EUA01234");
  assert.equal(tradeVals["odometer now reads miles no tenths"], "98765");
  assert.equal(tradeVals["SELLERS PRINTED NAME"], "Sample Trade Owner");
  assert.equal(tradeVals["BUYERS PRINTED NAME"], "DRIVE MAX USED CARS LLC");
  assert.equal(
    tradeVals["SELLERS street ADDRESS to include apartment or suite number"],
    "100 Example Lane",
  );
  assert.equal(
    tradeVals["BUYERS street ADDRESS to include apartment or suite number"],
    "6210 Old US Hwy 70 W",
  );
  assert.equal(
    formValues(trade181, context, {})[
      "SELLERS ADDRESS to include street apartment or suite number city state zip"
    ],
    "100 Example Lane New Bern NC 28562",
  );
  assert.equal(formValues(trade63, context, {}).VIN, "1FMCU9G90EUA01234");
  assert.equal(
    formValues(trade63, context, {})["BUYER,  SELLER, OR  LEGAL OWNER"],
    "Sample Trade Owner",
  );
  for (const f of tradeForms)
    for (const field of f.pages[0].fields.filter((x) => x.type === "checkbox"))
      assert.notEqual(
        formValues(f, context, {})[fieldKey(field)],
        true,
        "Never precheck condition attestations",
      );
  const corrections = {
    "trade-MVR-180": { "SELLERS PRINTED NAME": "Corrected Title Owner" },
    "MVR-180": { "SELLERS PRINTED NAME": "Original Dealer" },
  };
  assert.equal(
    formValues(trade180, context, corrections)["SELLERS PRINTED NAME"],
    "Corrected Title Owner",
  );
  assert.equal(
    formValues(sold180, context, corrections)["SELLERS PRINTED NAME"],
    "Original Dealer",
  );
  const load = async (f: { file: string }) =>
    new Uint8Array(
      await fs.readFile(new URL("../assets/forms/" + f.file, import.meta.url)),
    );
  for (const [name, forms] of [
    ["without-trade", without],
    ["with-trade", withTrade],
  ] as const) {
    const bytes = await buildSoldPack(context, {}, load, forms),
      pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), forms.length);
    assert.equal(pdf.getForm().getFields().length, 0);
    if (process.env.CRM_PDF_QA_DIR) {
      await fs.mkdir(process.env.CRM_PDF_QA_DIR, { recursive: true });
      await fs.writeFile(
        process.env.CRM_PDF_QA_DIR + "/" + name + ".pdf",
        bytes,
      );
    }
  }
});
