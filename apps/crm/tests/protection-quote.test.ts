import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  newProtectionQuoteItem,
  protectionQuoteCoverage,
  protectionQuoteCost,
  protectionQuoteProductSchema,
  protectionQuoteTotals,
  type ProtectionQuoteItem,
} from "../lib/protection-quote";
import {
  proposedPricing,
  type ProductPricing,
} from "../lib/protection-pricing";
import { buildProtectionQuotePdf } from "../lib/protection-pdf";
import {
  protectionPlans,
  protectionBatchSchema,
  protectionInputSchema,
} from "../lib/protection";
import { demoWorkspace } from "../lib/demo";
import { demoCommand } from "../lib/model";
const now = new Date("2026-10-31T16:00:00Z");
const pricing: ProductPricing = {
  id: randomUUID(),
  org_id: randomUUID(),
  draft: proposedPricing,
  active: proposedPricing,
  active_revision: 3,
  revision: 3,
  updated_at: now.toISOString(),
  updated_by: randomUUID(),
};
const items: ProtectionQuoteItem[] = [
  {
    ...newProtectionQuoteItem(randomUUID()),
    term_months: "6",
    term_miles: "6000",
    price: "300",
    deductible: "500",
    claim_limit: "5000",
  },
  {
    ...newProtectionQuoteItem(randomUUID(), "maintenance"),
    price: "699",
    maintenance_visits: "3",
  },
  { ...newProtectionQuoteItem(randomUUID(), "tire_wheel"), price: "499" },
  { ...newProtectionQuoteItem(randomUUID(), "pdr"), price: "699" },
  { ...newProtectionQuoteItem(randomUUID(), "appearance"), price: "599" },
  { ...newProtectionQuoteItem(randomUUID(), "key_replacement"), price: "299" },
];
test("standalone quote sums each product's allocation, supports short terms and does not show missing costs as zero", () => {
  assert.deepEqual(protectionQuoteTotals(items, pricing), {
    price: 3095,
    cost: 1373,
    gross: 1722,
  });
  assert.equal(protectionQuoteCost(items[0], pricing)?.scheduled_cost, 159.6);
  assert.equal(protectionQuoteCost(items[3], pricing)?.scheduled_cost, 65);
  assert.equal(protectionQuoteCost(items[3], pricing)?.cost, 279.6);
  assert.deepEqual(protectionQuoteTotals(items, { ...pricing, active: null }), {
    price: 3095,
    cost: null,
    gross: null,
  });
  assert.deepEqual(
    protectionQuoteTotals([newProtectionQuoteItem(randomUUID())], pricing),
    { price: null, cost: null, gross: null },
  );
  assert.equal(
    protectionQuoteCost({ ...items[0], term_miles: "" }, pricing),
    null,
  );
  assert.equal(
    protectionQuoteCost({ ...items[1], maintenance_visits: "" }, pricing),
    null,
  );
  assert.equal(
    protectionQuoteProductSchema.safeParse(
      protectionQuoteCoverage({ ...items[0], claim_limit: "" }),
    ).success,
    true,
  );
});
test("all six standalone products issue together with shared holder and vehicle, per-product prices and frozen costs", () => {
  const ws = demoWorkspace(now);
  ws.product_pricing = [pricing];
  const common = {
    customer_id: ws.customers[0].id,
    opportunity_id: null,
    quote_id: null,
    product_id: null,
    holder_name: "Alex Sample",
    co_holder: "",
    address: "123 Example Lane",
    city: "New Bern",
    state: "NC",
    zip: "28562",
    phone: "252-555-0100",
    email: "",
    vin: "1GNSKDKD7MR100250",
    year: 2021,
    make: "Chevrolet",
    model: "Tahoe",
    stock_number: "SAMPLE",
    issued_on: "2026-10-31",
    start_miles: 60000,
    lender: "",
    lender_address: "",
    dealer_sold: true,
  };
  const contracts = items.map((p) => ({
    id: p.id,
    contract: { ...common, ...protectionQuoteCoverage(p) },
  }));
  assert.equal(
    protectionInputSchema.safeParse({
      ...contracts[0].contract,
      claim_limit: null,
    }).success,
    false,
  );
  assert.equal(
    protectionInputSchema.safeParse({
      ...contracts[0].contract,
      start_miles: undefined,
    }).success,
    false,
  );
  assert.equal(
    protectionInputSchema.safeParse({ ...contracts[0].contract, issued_on: "" })
      .success,
    false,
  );
  const command = protectionBatchSchema.parse({
    type: "issue_protection_batch",
    id: randomUUID(),
    request_id: randomUUID(),
    contracts,
  });
  const next = demoCommand(ws, command, now);
  assert.equal(next.protection_contracts!.length, 6);
  assert.equal(
    next.protection_contracts!.find((c) => c.plan === "deluxe")!.expires_miles,
    66000,
  );
  assert.equal(
    next.protection_contracts!.find((c) => c.plan === "deluxe")!.expires_on,
    "2027-04-30",
  );
  assert.equal(
    next.protection_contracts!.find((c) => c.plan === "appearance")!
      .expires_miles,
    null,
  );
  for (const p of items) {
    const c = next.protection_contracts!.find((c) => c.id === p.id)!;
    assert.equal(c.batch_id, command.id);
    assert.equal(c.internal_cost, protectionQuoteCost(p, pricing)!.cost);
    assert.equal(c.price, Number(p.price));
  }
  assert.equal(demoCommand(next, command, now).protection_contracts!.length, 6);
  assert.equal(ws.protection_contracts?.length ?? 0, 0);
});
test("customer quote PDF includes all retail prices and terms, excludes internal fields, and paginates larger selections", async () => {
  const products = items.map((p) =>
    protectionQuoteProductSchema.parse(protectionQuoteCoverage(p)),
  );
  const logo = await readFile(
    new URL("../public/print-materials/drive-max-logo.png", import.meta.url),
  );
  const fonts = {
    regular: await readFile(
      new URL(
        "../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
        import.meta.url,
      ),
    ),
    bold: await readFile(
      new URL(
        "../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf",
        import.meta.url,
      ),
    ),
  };
  const quote = {
    prepared_on: "2026-10-31",
    holder_name: "Alex Sample",
    vehicle: "2021 Chevrolet Tahoe",
    vin: "1GNSKDKD7MR100250",
    products: products.map((p) => ({
      ...p,
      internal_cost: 12345.67,
      cost: 12345.67,
      notes: "SECRET_INTERNAL_SENTINEL",
      pricing_snapshot: { cost: 12345.67 },
    })),
  };
  const bytes = await buildProtectionQuotePdf(quote, logo, fonts);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  // Decode the actual PDF text content, including the embedded subset font.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const loaded = await task.promise;
  let text = "";
  for (let n = 1; n <= loaded.numPages; n++)
    text += (await (await loaded.getPage(n)).getTextContent()).items
      .map((x) => ("str" in x ? x.str : ""))
      .join(" ");
  await task.destroy();
  for (const p of products) assert.ok(text.includes(protectionPlans[p.plan]));
  assert.match(text, /3,095\.00/);
  assert.match(text, /QUOTATION ONLY/);
  assert.ok(
    !/SECRET_INTERNAL|12,345\.67|claims fund|product gross|internal_cost/i.test(
      text,
    ),
  );
  const large = await buildProtectionQuotePdf(
    {
      ...quote,
      products: Array.from(
        { length: 30 },
        (_, i) => products[i % products.length],
      ),
    },
    logo,
    fonts,
  );
  assert.ok((await PDFDocument.load(large)).getPageCount() > 1);
  await assert.rejects(
    () => buildProtectionQuotePdf({ ...quote, products: [] }),
    /Choose/,
  );
  await assert.rejects(
    () =>
      buildProtectionQuotePdf({
        ...quote,
        products: Array(31).fill(products[0]),
      }),
    /Choose/,
  );
  if (process.env.PROTECTION_QUOTE_SAMPLE_DIR) {
    await mkdir(process.env.PROTECTION_QUOTE_SAMPLE_DIR, { recursive: true });
    await writeFile(
      `${process.env.PROTECTION_QUOTE_SAMPLE_DIR}/protection-quote.pdf`,
      bytes,
    );
    await writeFile(
      `${process.env.PROTECTION_QUOTE_SAMPLE_DIR}/protection-quote-30.pdf`,
      large,
    );
  }
});
