import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PrintScaling, Duplex } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { bankConfigSchema, configuredCheckBank } from "../lib/company-check-bank-config";
import { checkMicrFields, micrGeometry } from "../lib/company-check-micr";
import { blankBottomCheckLayout } from "../lib/company-checks";
import { buildCompanyCheckPdf, sampleCheck } from "../lib/company-check-pdf";

// Fictional test account. No live dealership banking data belongs in fixtures.
const org = "12345678-1234-4123-8123-123456789001";
const accountId = "12345678-1234-4123-8123-123456789002";
const otherId = "12345678-1234-4123-8123-123456789003";
const config = { org_id: org, account_id: accountId, routing: "021000021", account: "000123456789" };
const account = { id: accountId, last4: "6789", bank_ready: true };
const raw = JSON.stringify(config);
const check = { ...sampleCheck, payee: "Fictional Test Payee", memo: "Test fixture only", account_last4: "6789", check_number: 230 };
const assets = async () => ({
  logo: await readFile(new URL("../public/print-materials/drive-max-logo.png", import.meta.url)),
  bank: { routing: config.routing, account: config.account, font: await readFile(new URL("../assets/checks/micr.ttf", import.meta.url)) },
});
async function printedText(bytes: Uint8Array) {
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.filter((item) => "str" in item);
  } finally { await task.destroy(); }
}

test("bank configuration preserves leading zeros and is scoped to ready account and organization", () => {
  assert.deepEqual(configuredCheckBank(raw, org, account), config);
  assert.equal(configuredCheckBank(raw, otherId, account), null);
  assert.equal(configuredCheckBank(raw, org, { ...account, id: otherId }), null);
  assert.equal(configuredCheckBank(raw, org, { ...account, last4: "9999" }), null);
  assert.equal(configuredCheckBank(raw, org, { ...account, last4: "" }), null);
  assert.equal(configuredCheckBank(raw, org, { ...account, last4: "789" }), null);
  assert.equal(configuredCheckBank(raw, org, { ...account, bank_ready: false }), null);
  assert.equal(configuredCheckBank(raw, org, { id: accountId, last4: "6789" }), null);
  assert.equal(bankConfigSchema.parse(config).routing, "021000021");
  assert.equal(bankConfigSchema.parse(config).account, "000123456789");
});

test("invalid configuration fails closed, including malformed JSON and invalid routing checksums", () => {
  for (const input of [undefined, "", "null", "{broken", "[]", "true"]) {
    assert.equal(configuredCheckBank(input, org, account), null);
  }
  for (const patch of [
    { routing: "021000022" }, { routing: "000000000" }, { routing: "21000021" },
    { routing: 21000021 }, { routing: " 021000021" }, { account: "123" },
    { account: "123456789012345678" }, { account: "1234-6789" },
    { org_id: "invalid" }, { account_id: "invalid" }, { unexpected: true },
  ]) assert.equal(configuredCheckBank(JSON.stringify({ ...config, ...patch }), org, account), null);
});

test("MICR uses fixed pitch and conventional routing, auxiliary on-us and account field positions", () => {
  assert.deepEqual(micrGeometry, { size: 18, pitch: 9, baseline: 13.5, rightInset: 22.5 });
  const fields = checkMicrFields({ routing: config.routing, account: config.account }, 230);
  assert.deepEqual(fields.map((f) => [f.text, f.endPosition]), [
    ["C00230C", 46], ["A021000021A", 33], ["000123456789C", 14],
  ]);
  assert.equal(fields[1].endPosition + fields[1].text.length - 1, 43);
  for (const field of fields) {
    assert.equal(field.y, 13.5);
    assert.ok(field.x > 0);
    const endInk = field.text.endsWith("A") ? 1731 : 1740;
    const rightInk = field.x + (field.text.length - 1) * 9 + endInk / 4096 * 18;
    assert.equal(rightInk, 612 - 22.5 - (field.endPosition - 1) * 9);
  }
  for (const number of [0, -1, 1.5, 999999999]) {
    assert.throws(() => checkMicrFields({ routing: config.routing, account: config.account }, number), /pending/);
  }
  assert.throws(() => checkMicrFields({ routing: "021000022", account: config.account }, 230), /pending/);
});

test("configured blank-stock PDF embeds correct MICR and removes preview markings only for live checks", async () => {
  const { logo, bank } = await assets();
  const bytes = await buildCompanyCheckPdf(check, blankBottomCheckLayout, false, logo, bank);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
  assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(), PrintScaling.None);
  assert.equal(pdf.catalog.getOrCreateViewerPreferences().getDuplex(), Duplex.Simplex);
  assert.equal(pdf.getTitle(), "Drive Max check 00230");
  const items = await printedText(bytes);
  const text = items.map((item) => item.str).join(" ");
  assert.match(text, /Fictional Test Payee/);
  assert.match(text, /ACCOUNT ENDING 6789/);
  assert.doesNotMatch(text, /VOID|PENDING|NOT NEGOTIABLE|PREVIEW ONLY/);
  for (const field of checkMicrFields({ routing: bank.routing, account: bank.account }, 230)) {
    const item = items.find((item) => item.str === field.text);
    assert.ok(item, "MICR field is present in the actual PDF");
    assert.equal(item.transform[5], 13.5);
    assert.ok(Math.abs(item.width - field.text.length * 9) < .001);
    assert.ok(Math.abs(item.transform[4] - field.x) < .001);
  }
  const previewBytes = await buildCompanyCheckPdf(check, blankBottomCheckLayout, true, logo, bank);
  const preview = await PDFDocument.load(previewBytes);
  assert.match(preview.getTitle()!, /^VOID.*00230/);
  const previewText = (await printedText(previewBytes)).map((item) => item.str).join(" ");
  assert.match(previewText, /VOID/);
  assert.match(previewText, /PREVIEW ONLY - NOT NEGOTIABLE/);
  assert.doesNotMatch(previewText, /BANK DETAILS PENDING/);
});

test("live blank-stock output rejects missing or invalid banking and mismatched account digits", async () => {
  const { logo, bank } = await assets();
  await assert.rejects(buildCompanyCheckPdf(check, blankBottomCheckLayout, false, logo), /pending/);
  await assert.rejects(buildCompanyCheckPdf(check, blankBottomCheckLayout, false, logo, { ...bank, routing: "021000022" }), /pending/);
  await assert.rejects(buildCompanyCheckPdf({ ...check, account_last4: "9999" }, blankBottomCheckLayout, false, logo, bank), /configured/);
  await assert.rejects(buildCompanyCheckPdf(check, blankBottomCheckLayout, false, logo, { ...bank, font: new Uint8Array() }));
});
