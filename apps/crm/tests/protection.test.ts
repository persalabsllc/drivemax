import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, defaultQuote } from "../lib/model";
import { fiOptionValues, newFIMenu } from "../lib/fi-menu";
import { productSchema } from "../lib/operations";
import { buildProtectionPdf } from "../lib/protection-pdf";
import {
  protectionExpiry,
  protectionInputSchema,
  protectionIssuer,
  protectionRefund,
  protectionVersion,
  type ProtectionContract,
  type ProtectionInput,
} from "../lib/protection";
const now = new Date("2026-10-31T16:00:00Z");
const input: ProtectionInput = {
  customer_id: randomUUID(),
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
  email: "alex@example.invalid",
  vin: "1GNSKDKD7MR100250",
  year: 2021,
  make: "Chevrolet",
  model: "Tahoe",
  stock_number: "SAMPLE-01",
  plan: "platinum",
  deductible: 250,
  price: 1995,
  issued_on: "2026-10-31",
  start_miles: 60000,
  term_months: 24,
  term_miles: 24000,
  claim_limit: 10000,
  lender: "Example Credit Union",
  lender_address: "100 Example Road, New Bern, NC 28562",
  dealer_sold: true,
};
const contract: ProtectionContract = {
  ...input,
  id: randomUUID(),
  org_id: randomUUID(),
  contract_number: "DMP-SAMPLE",
  expires_on: "2028-10-31",
  expires_miles: 84000,
  status: "active",
  claims_paid: 0,
  cancellation: null,
  revision: 1,
  terms_version: protectionVersion,
  issuer: protectionIssuer,
  created_at: now.toISOString(),
  created_by: randomUUID(),
};
test("contracts require date, odometer, both term limits, valid VIN and supported deductibles", () => {
  assert.equal(protectionInputSchema.safeParse(input).success, true);
  for (const patch of [
    { issued_on: "" },
    { issued_on: "2026-02-30" },
    { start_miles: undefined },
    { term_months: 0 },
    { term_miles: 0 },
    { price: 0 },
    { price: 1.555 },
    { deductible: 100 },
    { vin: "ABC" },
    { dealer_sold: false },
    { state: "VA" },
  ])
    assert.equal(
      protectionInputSchema.safeParse({ ...input, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  for (const deductible of [0, 250, 500, 1000])
    assert.equal(
      protectionInputSchema.safeParse({ ...input, deductible }).success,
      true,
    );
  assert.equal(protectionExpiry("2024-01-31", 1), "2024-02-29");
  assert.equal(protectionExpiry("2024-02-29", 12), "2025-02-28");
  assert.equal(protectionExpiry("2026-12-31", 2), "2027-02-28");
});
test("refund uses greater time or mileage, capped administration fee and paid claims, preserving cents", () => {
  const c = {
    ...contract,
    issued_on: "2024-01-31",
    expires_on: "2027-01-31",
    term_miles: 36000,
    price: 2000,
  };
  const mileage = protectionRefund(
    { ...c, claims_paid: 125.25 },
    "2024-02-29",
    78000,
  );
  assert.equal(mileage.prorated, 1000);
  assert.equal(mileage.admin_fee, 100);
  assert.equal(mileage.refund, 774.75);
  assert.equal(protectionRefund(c, "2024-02-29", 92400).admin_fee, 20);
  assert.equal(protectionRefund(c, "2024-02-29", 92400).refund, 180);
  assert.equal(protectionRefund(c, "2027-01-31", 60000).refund, 0);
  assert.equal(protectionRefund(c, "2024-01-31", 100000).refund, 0);
  assert.equal(
    protectionRefund({ ...c, claims_paid: 1500 }, "2024-02-29", 78000).refund,
    0,
  );
  const time = protectionRefund(c, "2025-07-31", 60001);
  assert.equal(time.used, time.time_used);
  assert.ok(time.used > 0.49);
  assert.throws(() => protectionRefund(c, "2024-01-30", 60000));
  assert.throws(() => protectionRefund(c, "2024-02-29", 59999));
  assert.throws(() => protectionRefund(c, "2024-02-29", 60000.5));
});
test("demo issuance, paid claims, cancellation and refund are immutable, idempotent and manager-only", () => {
  let ws = demoWorkspace(now);
  const id = randomUUID();
  const issue = {
    type: "issue_protection" as const,
    id,
    request_id: randomUUID(),
    contract: { ...input, customer_id: ws.customers[0].id },
  };
  ws = demoCommand(ws, issue, now);
  ws = demoCommand(ws, issue, now);
  assert.equal(ws.protection_contracts?.length, 1);
  assert.equal(ws.protection_events?.length, 1);
  assert.equal(ws.protection_contracts![0].expires_miles, 84000);
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...issue, contract: { ...issue.contract, price: 5 } },
        now,
      ),
    /request key/,
  );
  const claim = {
    type: "record_protection_claim" as const,
    id,
    request_id: randomUUID(),
    revision: 1,
    amount: 125.25,
    paid_on: input.issued_on,
    reference: "Paid repair 1",
    description: "Alternator",
  };
  ws = demoCommand(ws, claim, now);
  ws = demoCommand(ws, claim, now);
  assert.equal(ws.protection_contracts![0].claims_paid, 125.25);
  const cancel = {
    type: "cancel_protection" as const,
    id,
    request_id: randomUUID(),
    revision: 2,
    canceled_on: input.issued_on,
    mileage: 72000,
    reason: "Customer request",
    payee: input.holder_name,
  };
  ws = demoCommand(ws, cancel, now);
  ws = demoCommand(ws, cancel, now);
  assert.equal(ws.protection_contracts![0].cancellation?.refund, 772.5);
  assert.equal(ws.protection_events![2].result.claims_paid, 0);
  assert.throws(
    () =>
      demoCommand(ws, { ...claim, request_id: randomUUID(), revision: 3 }, now),
    /canceled/,
  );
  const refund = {
    type: "record_protection_refund" as const,
    id,
    request_id: randomUUID(),
    revision: 3,
    paid_on: input.issued_on,
    reference: "Check 123",
  };
  ws = demoCommand(ws, refund, now);
  ws = demoCommand(ws, refund, now);
  assert.equal(ws.protection_events!.length, 4);
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...refund, request_id: randomUUID(), revision: 4 },
        now,
      ),
    /already/,
  );
  assert.throws(
    () =>
      demoCommand(
        { ...ws, member: { ...ws.member, role: "sales" } },
        { ...issue, id: randomUUID(), request_id: randomUUID() },
        now,
      ),
    /Manager/,
  );
});
test("Desking only issues the saved selected product and prevents duplicates and stale vehicle issuance", () => {
  let ws = demoWorkspace(now);
  const o =
    ws.opportunities.find((o) => o.status === "new") ?? ws.opportunities[0];
  const product = productSchema.parse({
    id: randomUUID(),
    kind: "service_contract",
    protection_plan: "platinum",
    provider: "Drive Max",
    contract_number: "",
    term_months: 24,
    mileage_limit: 24000,
    deductible: 250,
    price: 1995,
    cost: 500,
    notes: "",
  });
  const menu = newFIMenu([product]);
  menu.packages[0].product_ids = [product.id];
  const values = fiOptionValues(defaultQuote, menu, 0);
  ws = demoCommand(
    ws,
    {
      type: "save_quote",
      customer_id: o.customer_id,
      opportunity_id: o.id,
      vehicle: o.vehicle_interest,
      values,
    },
    now,
  );
  const q = ws.quotes.find((q) => q.opportunity_id === o.id)!;
  const issue = {
    type: "issue_protection" as const,
    id: randomUUID(),
    request_id: randomUUID(),
    contract: {
      ...input,
      customer_id: o.customer_id,
      opportunity_id: o.id,
      quote_id: q.id,
      product_id: product.id,
      vin: q.vehicle_details?.vin || input.vin,
    },
  };
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...issue, contract: { ...issue.contract, price: 2000 } },
        now,
      ),
    /match/,
  );
  ws = demoCommand(ws, issue, now);
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...issue, id: randomUUID(), request_id: randomUUID() },
        now,
      ),
    /already/,
  );
  ws.opportunities.find((x) => x.id === o.id)!.inventory_id = randomUUID();
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...issue, id: randomUUID(), request_id: randomUUID() },
        now,
      ),
    /current F&I/,
  );
});
test("issued PDF contains five printable letter pages, with a separate cancellation statement", async () => {
  const logo = new Uint8Array(
    await readFile(
      new URL("../public/print-materials/drive-max-logo.png", import.meta.url),
    ),
  );
  const fonts = {
    regular: new Uint8Array(
      await readFile(
        new URL(
          "../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
          import.meta.url,
        ),
      ),
    ),
    bold: new Uint8Array(
      await readFile(
        new URL(
          "../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf",
          import.meta.url,
        ),
      ),
    ),
  };
  const bytes = await buildProtectionPdf(contract, logo, true, false, fonts);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 5);
  pdf
    .getPages()
    .forEach((p) => assert.deepEqual(p.getSize(), { width: 612, height: 792 }));
  const canceled: ProtectionContract = {
    ...contract,
    status: "canceled",
    cancellation: {
      ...protectionRefund(contract, input.issued_on, 72000),
      canceled_on: input.issued_on,
      mileage: 72000,
      reason: "Customer request",
      payee: input.holder_name,
      paid_on: null,
      payment_reference: "",
    },
  };
  assert.equal(
    (
      await PDFDocument.load(
        await buildProtectionPdf(canceled, logo, false, true, fonts),
      )
    ).getPageCount(),
    1,
  );
  // Optional local visual verification artifact uses fictional data only.
  if (process.env.PROTECTION_SAMPLE_DIR) {
    await mkdir(process.env.PROTECTION_SAMPLE_DIR, { recursive: true });
    await writeFile(
      `${process.env.PROTECTION_SAMPLE_DIR}/Drive-Max-Protection-Sample.pdf`,
      bytes,
    );
  }
});
