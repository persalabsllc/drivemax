import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  proposedPricing,
  protectionCost,
  priceProduct,
  protectionFund,
  validatePricedValues,
  pricingConfigSchema,
} from "../lib/protection-pricing";
import { demoWorkspace } from "../lib/demo";
import { demoCommand } from "../lib/model";
import { customerFIProduct } from "../lib/fi-menu";
import { productSchema, quoteGross, type FIProduct } from "../lib/operations";
import { defaultQuote } from "../lib/model";
import {
  protectionDraft,
  protectionInputSchema,
  protectionDefaults,
  protectionRefund,
} from "../lib/protection";
const now = new Date("2026-10-31T16:00:00Z");
const sample: FIProduct = {
  id: randomUUID(),
  kind: "service_contract",
  protection_plan: "deluxe",
  term_months: 24,
  mileage_limit: 36000,
  deductible: 250,
  price: 2499,
  cost: null,
  provider: "Drive Max",
  contract_number: "",
  notes: "Internal only",
};
test("proposed rates require separate owner activation; drafts and old snapshots stay independent", () => {
  let ws = demoWorkspace(now);
  const draft = {
    type: "save_product_pricing" as const,
    request_id: randomUUID(),
    revision: 0,
    config: structuredClone(proposedPricing),
  };
  ws = demoCommand(ws, draft, now);
  assert.equal(ws.product_pricing?.[0].active, null);
  assert.equal(priceProduct(sample, ws.product_pricing?.[0]).cost, null);
  assert.deepEqual(demoCommand(ws, draft, now), ws);
  const manager = structuredClone(ws);
  manager.member.role = "manager";
  const activate = {
    type: "activate_product_pricing" as const,
    request_id: randomUUID(),
    revision: 1,
    approved: true as const,
  };
  assert.throws(() => demoCommand(manager, activate, now), /Owner approval/);
  ws = demoCommand(ws, activate, now);
  const priced = priceProduct(sample, ws.product_pricing?.[0]);
  assert.equal(priced.cost, 1197);
  const next = structuredClone(proposedPricing);
  next.rates.deluxe.amount = 499;
  ws = demoCommand(
    ws,
    { ...draft, request_id: randomUUID(), revision: 2, config: next },
    now,
  );
  assert.equal(priceProduct(sample, ws.product_pricing?.[0]).cost, 1197);
  ws = demoCommand(
    ws,
    { ...activate, request_id: randomUUID(), revision: 3 },
    now,
  );
  assert.equal(priceProduct(sample, ws.product_pricing?.[0]).cost, 1497);
  assert.equal(priced.cost, 1197);
  assert.throws(
    () => validatePricedValues({ products: [priced] }, ws.product_pricing?.[0]),
    /pricing changed/,
  );
  assert.throws(
    () => demoCommand(ws, { ...draft, request_id: randomUUID() }, now),
    /settings changed/,
  );
});
test("term, mileage, maintenance visits, flat pricing, floor and half-cent rounding", () => {
  const calc = (p: Partial<FIProduct>) =>
    protectionCost({ ...sample, ...p }, proposedPricing, 1)!;
  assert.equal(
    calc({ term_months: 48, mileage_limit: 12000 }).scheduled_cost,
    1596,
  );
  assert.equal(
    calc({ term_months: 12, mileage_limit: 48000 }).scheduled_cost,
    1596,
  );
  assert.equal(
    calc({
      protection_plan: "platinum",
      term_months: 12,
      mileage_limit: 12000,
      price: 1000,
    }).cost,
    599,
  );
  assert.equal(
    calc({
      protection_plan: "maintenance",
      maintenance_visits: 6,
      price: 1000,
    }).cost,
    750,
  );
  assert.equal(
    calc({ protection_plan: "maintenance", maintenance_visits: undefined }),
    null,
  );
  assert.equal(
    calc({
      protection_plan: "appearance",
      term_months: 96,
      unlimited_miles: true,
      price: 300,
    }).cost,
    199,
  );
  assert.equal(calc({ protection_plan: "appearance", price: 1000 }).cost, 400);
  assert.equal(
    calc({ protection_plan: "tire_wheel", term_months: 18, price: 100 }).cost,
    130.5,
  );
  const special = structuredClone(proposedPricing);
  special.rates.pdr.amount = 10.01;
  special.reserve_percent = 0;
  assert.equal(
    protectionCost(
      { ...sample, protection_plan: "pdr", term_months: 6 },
      special,
      1,
    )?.cost,
    5.01,
  );
  assert.equal(
    pricingConfigSchema.safeParse({ ...special, annual_miles: 0 }).success,
    false,
  );
});
test("customer projection excludes reserve costs, rates, profit and internal notes", () => {
  const snapshot = protectionCost(sample, proposedPricing, 2)!;
  const priced = productSchema.parse({
    ...sample,
    cost: snapshot.cost,
    pricing_snapshot: snapshot,
  });
  const customer = customerFIProduct(priced);
  for (const field of [
    "cost",
    "pricing_snapshot",
    "scheduled_cost",
    "reserve_floor",
    "notes",
  ])
    assert.equal(field in customer, false);
  assert.equal(customer.price, 2499);
  const gross = quoteGross(
    { ...defaultQuote, products: [priced] },
    { cost: 100, recon: 0 },
    { product_costs: { [priced.id]: 1 } },
  );
  assert.equal(gross.back, 2499 - snapshot.cost);
});
test("fund holds frozen costs after expiry, keeps unpaid refunds due and flags unknown allocations", () => {
  const ws = demoWorkspace(now);
  const contract = protectionDraft(
    protectionInputSchema.parse({
      ...protectionDefaults(ws.customers[0]),
      address: "123 Example Lane",
      city: "New Bern",
      zip: "28562",
      phone: "2525550100",
      vin: "1GNSKDKD7MR100250",
      year: 2021,
      make: "Chevrolet",
      model: "Tahoe",
      issued_on: "2024-01-01",
      start_miles: 60000,
      term_months: 12,
      term_miles: 12000,
      price: 2000,
      claim_limit: 5000,
      dealer_sold: true,
    }),
  );
  contract.internal_cost = 1000;
  contract.claims_paid = 100;
  ws.protection_contracts = [
    contract,
    { ...contract, id: randomUUID(), internal_cost: null },
  ];
  assert.equal(protectionFund(ws).target, 900);
  assert.equal(protectionFund(ws).unknown, 1);
  assert.equal(protectionFund(ws).balance, 0);
  contract.status = "canceled";
  contract.cancellation = {
    ...protectionRefund(contract, "2024-06-01", 62000),
    canceled_on: "2024-06-01",
    mileage: 62000,
    reason: "Customer request",
    payee: "Example customer",
    paid_on: null,
    payment_reference: "",
  };
  assert.equal(protectionFund(ws).target, contract.cancellation.refund);
  contract.cancellation.paid_on = "2024-06-02";
  assert.equal(protectionFund(ws).target, 0);
});
test("claims cash ledger requires explicit entries, supports immutable corrections and rejects sales access", () => {
  let ws = demoWorkspace(now);
  const entry = {
    type: "record_protection_fund" as const,
    request_id: randomUUID(),
    direction: "in" as const,
    amount: 350.25,
    posted_on: "2026-10-31",
    reference: "Example transfer",
    notes: "",
    contract_id: null,
  };
  ws = demoCommand(ws, entry, now);
  ws = demoCommand(ws, entry, now);
  assert.equal(protectionFund(ws).balance, 350.25);
  const sales = structuredClone(ws);
  sales.member.role = "sales";
  assert.throws(
    () => demoCommand(sales, { ...entry, request_id: randomUUID() }, now),
    /Manager access/,
  );
  assert.throws(
    () => demoCommand(ws, { ...entry, amount: 200 }, now),
    /new request key/,
  );
  const reverse = {
    type: "reverse_protection_fund" as const,
    request_id: randomUUID(),
    id: entry.request_id,
    posted_on: "2026-10-31",
    reason: "Wrong account",
  };
  ws = demoCommand(ws, reverse, now);
  assert.equal(protectionFund(ws).balance, 0);
  assert.equal(ws.protection_fund_entries?.length, 2);
  assert.throws(
    () => demoCommand(ws, { ...reverse, request_id: randomUUID() }, now),
    /already been reversed/,
  );
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...entry, request_id: randomUUID(), posted_on: "2026-11-01" },
        now,
      ),
    /valid fund/,
  );
});
