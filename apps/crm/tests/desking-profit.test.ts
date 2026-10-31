import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultQuote, type QuoteValues } from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  emptyAccounting,
  quoteGross,
  saleMath,
  type FIProduct,
  type Sale,
} from "../lib/operations";
import { selectedDeskingValues } from "../lib/desking";
import { QuickQuote } from "../components/QuickQuote";
import { PriceQuotePrint } from "../components/PriceQuotePrint";
import { customerQuoteLines } from "../lib/quote-export";

const vehicle = { cost: 12000, recon: 500 };
const product: FIProduct = {
  id: "00000000-0000-4000-8000-000000000099",
  kind: "service_contract",
  provider: "Sample provider",
  contract_number: "",
  term_months: 36,
  mileage_limit: 36000,
  deductible: 100,
  cost: 600,
  price: 1500,
  notes: "",
};
const values: QuoteValues = {
  ...defaultQuote,
  price: 16000,
  docFee: 399,
  tradeAllowance: 4000,
  acv: 3500,
  products: [product],
};

test("desking gross changes immediately with price, trade, doc fee and products, including losses", () => {
  assert.equal(quoteGross(values, vehicle).front, 3399);
  assert.equal(quoteGross(values, vehicle).back, 900);
  assert.equal(quoteGross(values, vehicle).gross, 4299);
  assert.equal(quoteGross({ ...values, price: 15000 }, vehicle).front, 2399);
  assert.equal(quoteGross({ ...values, price: 12000 }, vehicle).front, -601);
  assert.equal(
    quoteGross({ ...values, tradeAllowance: 5000 }, vehicle).front,
    2399,
  );
  assert.equal(quoteGross({ ...values, acv: 4500 }, vehicle).front, 4399);
  assert.equal(quoteGross({ ...values, docFee: 499 }, vehicle).front, 3499);
  assert.equal(
    quoteGross({ ...values, products: [{ ...product, price: 1000 }] }, vehicle)
      .back,
    400,
  );
  assert.equal(quoteGross({ ...values, products: [] }, vehicle).back, 0);
});

test("financing, payment selection, customer display toggles and trade recon do not inflate gross", () => {
  const baseline = quoteGross(values, vehicle);
  const edited = selectedDeskingValues({
    ...values,
    tax: 1000,
    titleFee: 300,
    otherTaxes: 500,
    payoff: 2000,
    downPayment: 5000,
    recon: 800,
    apr: 10,
    months: 48,
    daysToFirstPayment: 90,
    showProtectionProducts: false,
    financeOptions: [
      { months: 36, apr: 8 },
      { months: 48, apr: 9 },
      { months: 60, apr: 10 },
    ],
    downPayments: [1000, 2000, 3000],
    selectedOption: 0,
    selectedDown: 2,
  });
  assert.deepEqual(quoteGross(edited, vehicle), baseline);
  assert.deepEqual(quoteGross({ ...edited, mode: "cash" }, vehicle), baseline);
});

test("missing vehicle and product costs stay unknown, while recorded zero costs remain valid", () => {
  assert.equal(quoteGross(values, null).front, null);
  assert.equal(quoteGross(values, { cost: null, recon: 0 }).front, null);
  assert.equal(quoteGross(values, { cost: 0, recon: null }).front, null);
  assert.equal(quoteGross(values, { cost: 0, recon: 0 }).front, 15899);
  const missing = quoteGross(
    { ...values, products: [{ ...product, cost: null }] },
    vehicle,
  );
  assert.equal(missing.front, 3399);
  assert.equal(missing.back, null);
  assert.equal(missing.gross, null);
  assert.equal(missing.complete, false);
  assert.equal(
    quoteGross({ ...values, products: [{ ...product, cost: 0 }] }, vehicle)
      .back,
    1500,
  );
  assert.equal(
    quoteGross(
      { ...values, products: undefined, serviceContract: 1500 },
      vehicle,
    ).back,
    null,
  );
  assert.equal(
    quoteGross({ ...values, products: [], serviceContract: 9999 }, vehicle)
      .back,
    0,
  );
});

test("recorded accounting overrides inventory and product costs without confusing pack with gross", () => {
  const accounting = {
    ...emptyAccounting,
    vehicle_cost: 10000,
    recon: 250,
    accessory_cost: 100,
    other_cost: 200,
    finance_reserve: 350,
    pack: 500,
    product_costs: { [product.id]: 400 },
  };
  const m = quoteGross({ ...values, addOns: 500 }, vehicle, accounting);
  assert.equal(m.front, 5849);
  assert.equal(m.back, 1450);
  assert.equal(m.gross, 7299);
  assert.equal(
    quoteGross(values, vehicle, {
      ...accounting,
      product_costs: { [product.id]: null },
    }).back,
    null,
  );
  assert.equal(
    quoteGross(values, vehicle, { ...accounting, vehicle_cost: 0, recon: 0 })
      .cost,
    0,
  );
});

test("closed-deal desking uses the same gross as Accounting, including missing trade snapshots", () => {
  const ws = demoWorkspace();
  const sale: Sale = {
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    opportunity_id: ws.opportunities[0].id,
    customer_id: ws.customers[0].id,
    sold_on: "2026-10-31",
    created_at: "2026-10-31T12:00:00Z",
    status: "sold",
    revision: 0,
    unwound_at: null,
    unwind_reason: "",
    snapshot: {
      customer: ws.customers[0],
      opportunity: { ...ws.opportunities[0], trade: null },
      quote: {
        ...ws.quotes[0],
        values,
        vehicle_details: { ...ws.inventory[0], ...vehicle },
        trade_snapshot: null,
      },
      salesperson: null,
    },
    accounting: { ...emptyAccounting, finance_reserve: 250 },
  };
  const expected = quoteGross(values, vehicle, sale.accounting, null);
  const actual = saleMath(sale);
  assert.equal(actual.front, expected.front);
  assert.equal(actual.back, expected.back);
  assert.equal(actual.gross, expected.gross);
  assert.equal(actual.adjustment, 0);
});

test("manager and owner profit starts hidden next to price; sales staff have no profit control", () => {
  const ws = demoWorkspace();
  for (const role of ["owner", "manager", "sales"]) {
    const html = renderToStaticMarkup(
      createElement(QuickQuote, {
        ws: { ...ws, member: { ...ws.member, role } },
        busy: false,
        error: "",
        demo: true,
        onClose() {},
        onClearError() {},
        onPrint() {},
        onComplete() {},
        onCreate: async () => ({ ok: true }),
      }),
    );
    if (role === "sales") assert.ok(!html.includes("Show profit"));
    else {
      assert.ok(html.includes("Show profit"));
      assert.ok(html.includes('aria-expanded="false"'));
      assert.ok(html.indexOf("Selling price") < html.indexOf("Show profit"));
      assert.ok(
        html.indexOf("Show profit") <
          html.indexOf("Accessories / taxable add-ons"),
      );
    }
    assert.ok(!html.includes("Front gross"));
    assert.ok(!html.includes("Back gross"));
  }
});

test("customer quote output contains no internal gross or cost breakdown", () => {
  const ws = demoWorkspace();
  const quote = {
    ...ws.quotes[0],
    values,
    vehicle_details: { ...ws.inventory[0], ...vehicle },
  };
  const html = renderToStaticMarkup(
    createElement(PriceQuotePrint, {
      customer: ws.customers[0],
      quote,
      dealership: ws.org.name,
    }),
  );
  const lines = JSON.stringify(customerQuoteLines(quote, ws.customers[0]));
  for (const output of [html, lines]) {
    assert.doesNotMatch(
      output,
      /Front gross|Back gross|Total gross|Deal profit|Vehicle cost|Product cost|Show profit/i,
    );
  }
});
