import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, defaultQuote } from "../lib/model";
import {
  fiOptionValues,
  newFIMenu,
  fiCoverage,
  customerFIProduct,
} from "../lib/fi-menu";
import { productSchema, type FIProduct } from "../lib/operations";
import {
  protectionInputSchema,
  protectionBatchSchema,
  protectionDraft,
  protectionRefund,
  protectionProductInput,
  type ProtectionInput,
} from "../lib/protection";
import {
  protectionKind,
  type ProtectionPlan,
} from "../lib/protection-programs";
import {
  buildProtectionPdf,
  buildProtectionPacketPdf,
} from "../lib/protection-pdf";
const now = new Date("2026-10-31T16:00:00Z");
const base: ProtectionInput = {
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
  issued_on: "2024-01-31",
  start_miles: 60000,
  term_months: 48,
  term_miles: 48000,
  claim_limit: 10000,
  lender: "",
  lender_address: "",
  dealer_sold: true,
};
const plans: ProtectionPlan[] = [
  "platinum",
  "maintenance",
  "tire_wheel",
  "pdr",
  "appearance",
  "key_replacement",
];
function product(plan: ProtectionPlan): FIProduct {
  return productSchema.parse({
    id: randomUUID(),
    kind: protectionKind(plan),
    protection_plan: plan,
    provider: "Drive Max Used Cars LLC",
    contract_number: "",
    price: plan === "platinum" ? 1995 : 499,
    cost: 123,
    notes: "INTERNAL - DO NOT PRINT",
    deductible: plan === "platinum" ? 250 : 0,
    term_months: plan === "appearance" ? 96 : 48,
    mileage_limit: plan === "platinum" ? 48000 : 0,
    unlimited_miles: plan !== "platinum",
    ...(plan === "maintenance" ? { maintenance_visits: 4 } : {}),
    ...(plan === "platinum" ? { claim_limit: 10000 } : {}),
  });
}
function input(plan: ProtectionPlan): ProtectionInput {
  return protectionInputSchema.parse({
    ...base,
    ...protectionProductInput(product(plan)),
    product_id: null,
  });
}
function selectedDeal() {
  let ws = demoWorkspace(now);
  const o = ws.opportunities.find((o) => o.status === "new")!;
  const products = plans.map(product);
  const gap = productSchema.parse({
    ...product("tire_wheel"),
    protection_plan: undefined,
    unlimited_miles: undefined,
    kind: "gap",
    price: 300,
  });
  const menu = newFIMenu([...products, gap]);
  menu.packages[0].product_ids = [...products, gap].map((p) => p.id);
  ws = demoCommand(
    ws,
    {
      type: "save_quote",
      customer_id: o.customer_id,
      opportunity_id: o.id,
      vehicle: o.vehicle_interest,
      values: fiOptionValues(defaultQuote, menu, 0),
    },
    now,
  );
  const q = ws.quotes.find((q) => q.opportunity_id === o.id)!;
  const command = protectionBatchSchema.parse({
    type: "issue_protection_batch",
    id: randomUUID(),
    request_id: randomUUID(),
    contracts: products.map((p) => ({
      id: randomUUID(),
      contract: {
        ...base,
        ...protectionProductInput(p),
        customer_id: o.customer_id,
        opportunity_id: o.id,
        quote_id: q.id,
        vin: q.vehicle_details?.vin || base.vin,
      },
    })),
  });
  return { ws, command, q, products };
}
test("product rules distinguish unlimited mileage, eight-year appearance, $125 visits and mechanical-only deductibles", () => {
  for (const plan of plans)
    assert.equal(protectionInputSchema.safeParse(input(plan)).success, true);
  for (const patch of [
    { term_months: 95 },
    { term_miles: 1 },
    { deductible: 250 },
    { claim_limit: 10000 },
  ])
    assert.equal(
      protectionInputSchema.safeParse({ ...input("appearance"), ...patch })
        .success,
      false,
    );
  for (const patch of [
    { maintenance_visits: undefined },
    { maintenance_visits: 0 },
    { claim_limit: 999 },
    { deductible: 250 },
  ])
    assert.equal(
      protectionInputSchema.safeParse({ ...input("maintenance"), ...patch })
        .success,
      false,
    );
  assert.equal(
    productSchema.safeParse({
      ...product("appearance"),
      unlimited_miles: false,
    }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({ ...product("key_replacement"), kind: "gap" })
      .success,
    false,
  );
  assert.equal(
    productSchema.safeParse({
      ...product("maintenance"),
      maintenance_visits: undefined,
    }).success,
    false,
  );
  assert.match(fiCoverage(product("maintenance")), /4 visits.*\$125/);
  assert.match(fiCoverage(product("appearance")), /96 months.*Unlimited/);
  const safe = JSON.stringify(customerFIProduct(product("maintenance")));
  assert.ok(!safe.includes("INTERNAL"));
  assert.ok(!safe.includes('"cost"'));
});
test("one atomic menu command issues all six selected programs, retains their prices, and does not issue outside GAP", () => {
  const { ws, command, products } = selectedDeal();
  assert.equal(
    protectionBatchSchema.safeParse({ ...command, contracts: [] }).success,
    false,
  );
  const bad = structuredClone(command);
  bad.contracts[5].contract.price++;
  assert.throws(() => demoCommand(ws, bad, now), /match/);
  assert.equal(ws.protection_contracts?.length ?? 0, 0);
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...command, contracts: command.contracts.slice(0, 1) },
        now,
      ),
    /remaining selected/,
  );
  const changed = structuredClone(command);
  changed.contracts[5].contract.vin = "1HGCV1F34JA000001";
  assert.equal(protectionBatchSchema.safeParse(changed).success, false);
  const next = demoCommand(ws, command, now);
  assert.equal(next.protection_contracts!.length, 6);
  assert.ok(next.protection_contracts!.every((c) => c.batch_id === command.id));
  for (const p of products)
    assert.equal(
      next.protection_contracts!.find((c) => c.product_id === p.id)!.price,
      p.price,
    );
  assert.equal(demoCommand(next, command, now).protection_contracts!.length, 6);
  assert.equal(
    next.quotes.find((q) => q.id === command.contracts[0].contract.quote_id)!
      .values.serviceContract,
    products.reduce((n, p) => n + p.price, 0) + 300,
  );
  assert.throws(
    () =>
      demoCommand(
        { ...ws, member: { ...ws.member, role: "sales" } },
        command,
        now,
      ),
    /Manager/,
  );
});
function issued(plan: ProtectionPlan) {
  let ws = demoWorkspace(now);
  const id = randomUUID();
  ws = demoCommand(
    ws,
    {
      type: "issue_protection",
      id,
      request_id: randomUUID(),
      contract: { ...input(plan), customer_id: ws.customers[0].id },
    },
    now,
  );
  return { ws, id };
}
function claim(
  ws: ReturnType<typeof demoWorkspace>,
  id: string,
  on: string,
  units = 1,
  amount = 100,
  reference: string = randomUUID(),
) {
  return {
    type: "record_protection_claim" as const,
    id,
    request_id: randomUUID(),
    revision: ws.protection_contracts!.find((c) => c.id === id)!.revision,
    amount,
    paid_on: "2026-10-31",
    service_on: on,
    mileage: 61000,
    units,
    reference,
    description: "Fictional covered service",
  };
}
test("key limits enforce three lifetime and two in every rolling twelve months, including backdated claims", () => {
  let { ws, id } = issued("key_replacement");
  ws = demoCommand(ws, claim(ws, id, "2025-01-01"), now);
  ws = demoCommand(ws, claim(ws, id, "2025-07-01"), now);
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2025-12-31"), now),
    /rolling/,
  );
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2025-04-01"), now),
    /rolling/,
  );
  const third = claim(ws, id, "2026-01-01");
  ws = demoCommand(ws, third, now);
  ws = demoCommand(ws, third, now);
  assert.equal(ws.protection_contracts![0].claims_paid, 300);
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2026-07-01"), now),
    /3 keys/,
  );
  assert.throws(() =>
    demoCommand(ws, { ...claim(ws, id, "2026-07-01"), units: 0 }, now),
  );
});
test("maintenance counts visits independently of dollars, rejects duplicate payments, and caps each visit at $125", () => {
  let { ws, id } = issued("maintenance");
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2025-01-01", 1, 125.01), now),
    /\$125/,
  );
  for (let i = 0; i < 4; i++) {
    const p = claim(ws, id, `2025-0${i + 1}-01`, 1, 20, `INVOICE-${i}`);
    ws = demoCommand(ws, p, now);
    assert.throws(
      () =>
        demoCommand(
          ws,
          {
            ...p,
            request_id: randomUUID(),
            revision: ws.protection_contracts![0].revision,
          },
          now,
        ),
      /reference/,
    );
  }
  assert.equal(ws.protection_contracts![0].claims_paid, 80);
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2025-06-01", 1, 20), now),
    /visit count/,
  );
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...claim(ws, id, "2025-01-01"), service_on: undefined },
        now,
      ),
    /service date/,
  );
});
test("appearance cancellation ignores mileage and service eligibility ends at the date boundary", () => {
  const c = protectionDraft(input("appearance"));
  assert.equal(c.expires_miles, null);
  assert.equal(c.expires_on, "2032-01-31");
  const low = protectionRefund(c, "2026-01-31", 60000),
    high = protectionRefund(c, "2026-01-31", 3000000);
  assert.deepEqual(low.refund, high.refund);
  assert.equal(high.mileage_used, 0);
  const { ws, id } = issued("tire_wheel");
  assert.throws(
    () => demoCommand(ws, claim(ws, id, "2023-12-31"), now),
    /outside coverage/,
  );
  assert.throws(
    () =>
      demoCommand(ws, { ...claim(ws, id, "2025-01-01"), mileage: 59999 }, now),
    /outside coverage/,
  );
});
test("packet PDF combines the original five-page warranty and five three-page ancillary agreements with a print index", async () => {
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
  const contracts = plans.map((plan, i) => ({
    ...protectionDraft(input(plan)),
    id: randomUUID(),
    contract_number: `DMP-SAMPLE-${i + 1}`,
  }));
  for (const c of contracts)
    assert.equal(
      (
        await PDFDocument.load(
          await buildProtectionPdf(c, logo, true, false, fonts),
        )
      ).getPageCount(),
      c.plan === "platinum" ? 5 : 3,
    );
  const bytes = await buildProtectionPacketPdf(contracts, logo, true, fonts);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 21);
  doc
    .getPages()
    .forEach((p) => assert.deepEqual(p.getSize(), { width: 612, height: 792 }));
  await assert.rejects(
    () =>
      buildProtectionPacketPdf([
        contracts[0],
        { ...contracts[1], vin: "1HGCV1F34JA000001" },
      ]),
    /same customer/,
  );
  if (process.env.PROTECTION_PACKET_SAMPLE_DIR) {
    await mkdir(process.env.PROTECTION_PACKET_SAMPLE_DIR, { recursive: true });
    await writeFile(
      `${process.env.PROTECTION_PACKET_SAMPLE_DIR}/Drive-Max-Protection-Product-Packet.pdf`,
      bytes,
    );
  }
});
