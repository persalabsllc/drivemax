import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PrintScaling, Duplex } from "pdf-lib";
import { blankBottomCheckLayout, formatCheckNumber, canPrintCompanyChecks, parseCheckAmount, checkAmountWords, checkCommandSchema, defaultCheckLayout } from "../lib/company-checks";
import { buildCompanyCheckPdf, sampleCheck } from "../lib/company-check-pdf";

test("check amounts preserve cents and reject rounding, exponent, negative and oversized input", () => {
  for (const [input, expected] of [["0.01", 1], ["1.5", 150], ["1250.09", 125009], ["999999.99", 99999999]] as const) assert.equal(parseCheckAmount(input), expected);
  for (const input of ["", "0", "0.00", "-12", "1.005", "1e4", "Infinity", "1,000", "1000000", "$50"]) assert.equal(parseCheckAmount(input), null);
  assert.equal(checkAmountWords(1), "Zero and 01/100");
  assert.equal(checkAmountWords(10101), "One Hundred One and 01/100");
  assert.equal(checkAmountWords(125009), "One Thousand Two Hundred Fifty and 09/100");
  assert.equal(checkAmountWords(10000000), "One Hundred Thousand and 00/100");
  assert.equal(checkAmountWords(99999999), "Nine Hundred Ninety-Nine Thousand Nine Hundred Ninety-Nine and 99/100");
});
test("blank bottom stock previews branding and 00230 but cannot issue an incomplete check", async () => {
  const logo = await readFile(new URL("../public/print-materials/drive-max-logo.png", import.meta.url));
  const check = { ...sampleCheck, check_number: 230, reference: "INV-1048", category: "Vehicle reconditioning", payment_details: "Oil and filter service - $74.00\nBrake service - $225.00" };
  assert.equal(formatCheckNumber(230), "00230");
  assert.equal(formatCheckNumber(231), "00231");
  assert.equal(formatCheckNumber(123456), "123456");
  const pdf = await PDFDocument.load(await buildCompanyCheckPdf(check, blankBottomCheckLayout, true, logo));
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
  assert.match(pdf.getTitle()!, /VOID.*00230.*pending/);
  assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(), PrintScaling.None);
  await assert.rejects(buildCompanyCheckPdf(check, blankBottomCheckLayout, false, logo), /pending/);
  await assert.rejects(buildCompanyCheckPdf(check, blankBottomCheckLayout, true), /logo/);
  await assert.rejects(buildCompanyCheckPdf(check, { ...blankBottomCheckLayout, y: 18 }, true, logo), /outside/);
  await assert.rejects(buildCompanyCheckPdf({ ...check, payment_details: "a\nb\nc\nd\ne\nf" }, blankBottomCheckLayout, true, logo), /five lines/);
  await assert.rejects(buildCompanyCheckPdf({ ...check, payment_details: "W".repeat(500) }, blankBottomCheckLayout, true, logo), /long words/);
});
test("check printing is owner-only; full bank data, invalid dates and ambiguous amounts are rejected", () => {
  assert.equal(canPrintCompanyChecks("owner"), true);
  for (const role of ["manager", "finance", "sales", "", "admin"]) assert.equal(canPrintCompanyChecks(role), false);
  const setup = { action: "save_account", id: "25ae2b75-b6f5-4ac7-a4f0-168e060598dd", revision: 0, name: "Company checking", last4: "1234", next_number: 1001, layout: defaultCheckLayout };
  assert.equal(checkCommandSchema.safeParse(setup).success, true);
  assert.equal(checkCommandSchema.safeParse({ ...setup, account_number: "123456789" }).success, false);
  assert.equal(checkCommandSchema.safeParse({ ...setup, last4: "123456789" }).success, false);
  const details = { payee: "Payee", amount_cents: 105, check_date: "2026-11-18", memo: "", address: "" };
  const create = { action: "create", id: setup.id, account_id: setup.id, check_number: 1001, details };
  assert.equal(checkCommandSchema.safeParse(create).success, true);
  for (const patch of [{ check_date: "2026-02-30" }, { amount_cents: 1.5 }, { payee: "Bad\nPayee" }, { address: "a\nb\nc\nd" }]) assert.equal(checkCommandSchema.safeParse({ ...create, details: { ...details, ...patch } }).success, false);
});
test("check PDF is one Letter sheet with Actual size/simplex and visibly void samples", async () => {
  const live = await PDFDocument.load(await buildCompanyCheckPdf({ ...sampleCheck, check_number: 1001, amount_cents: 99999999 }));
  assert.equal(live.getPages().length, 1);
  assert.deepEqual(live.getPage(0).getSize(), { width: 612, height: 792 });
  assert.equal(live.catalog.getOrCreateViewerPreferences().getPrintScaling(), PrintScaling.None);
  assert.equal(live.catalog.getOrCreateViewerPreferences().getDuplex(), Duplex.Simplex);
  const sample = await PDFDocument.load(await buildCompanyCheckPdf(sampleCheck, defaultCheckLayout, true));
  assert.match(sample.getTitle()!, /VOID/);
  await assert.rejects(buildCompanyCheckPdf(sampleCheck, { ...defaultCheckLayout, x: 18, fields: { ...defaultCheckLayout.fields, amount: { x: 18, y: 0 } } }), /outside/);
  await assert.rejects(buildCompanyCheckPdf({ ...sampleCheck, payee: "W".repeat(100) }), /too long/);
});
