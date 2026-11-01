import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultQuote,
  quoteSchema,
  demoCommand,
  type QuoteValues,
} from "../lib/model";
import {
  calculateQuote,
  emptyLenderFinance,
  lenderFinanceMath,
} from "../lib/finance";
import { deskingDraft, selectedDeskingValues } from "../lib/desking";
import {
  emptyAccounting,
  quoteGross,
  saleMath,
  defaultCommission,
} from "../lib/operations";
import { demoWorkspace } from "../lib/demo";
import { restrictWorkspace } from "../lib/workspace-permissions";
import { PriceQuotePrint } from "../components/PriceQuotePrint";
import { FIMenuPrint } from "../components/FIMenuPrint";
import { customerQuoteLines } from "../lib/quote-export";
import { newFIMenu } from "../lib/fi-menu";

const f = {
  ...emptyLenderFinance,
  lender: "PRIVATE-BANK-NAME",
  buyRate: 14,
  payoutPercent: 75,
  lenderFees: 300,
};
const v: QuoteValues = {
  ...defaultQuote,
  price: 20000,
  docFee: 0,
  titleFee: 0,
  apr: 16,
  months: 60,
  daysToFirstPayment: 30,
  mode: "finance",
  taxMode: "manual",
  products: [],
  lenderFinance: f,
};
const vehicle = { cost: 12000, recon: 500 };
test("reserve uses the payment difference, term and lender payout; fees only reduce front gross", () => {
  const m = lenderFinanceMath(v),
    gross = quoteGross(v, vehicle);
  assert.equal(m.buyPayment, 465.37);
  assert.equal(calculateQuote(v).payment, 486.36);
  assert.equal(m.reserve, 944.55);
  assert.equal(gross.front, 7200);
  assert.equal(gross.back, 944.55);
  assert.equal(gross.gross, 8144.55);
  assert.deepEqual(
    calculateQuote(v),
    calculateQuote({ ...v, lenderFinance: undefined }),
  );
  assert.ok(lenderFinanceMath({ ...v, downPayment: 5000 }).reserve < m.reserve);
  assert.ok(lenderFinanceMath({ ...v, months: 48 }).reserve < m.reserve);
  assert.ok(
    lenderFinanceMath({ ...v, daysToFirstPayment: 45 }).reserve > m.reserve,
  );
  assert.ok(lenderFinanceMath({ ...v, price: 21000 }).reserve > m.reserve);
});
test("cash, missing and zero buy rates, no markup, payout limits and confirmed overrides", () => {
  for (const apr of [0, 12, 14])
    assert.equal(lenderFinanceMath({ ...v, apr }).reserve, 0);
  assert.equal(
    lenderFinanceMath({ ...v, lenderFinance: { ...f, buyRate: null } }).reserve,
    0,
  );
  assert.ok(
    lenderFinanceMath({ ...v, lenderFinance: { ...f, buyRate: 0 } }).reserve >
      0,
  );
  assert.equal(
    lenderFinanceMath({ ...v, lenderFinance: { ...f, payoutPercent: 0 } })
      .reserve,
    0,
  );
  for (const reserveOverride of [0, 700]) {
    const data = { ...v, lenderFinance: { ...f, reserveOverride } };
    assert.equal(lenderFinanceMath(data).reserve, reserveOverride);
    assert.equal(lenderFinanceMath(data).source, "confirmed");
    assert.equal(lenderFinanceMath({ ...data, mode: "cash" }).reserve, 0);
  }
  assert.equal(quoteGross({ ...v, mode: "cash" }, vehicle).front, 7500);
  assert.equal(quoteGross({ ...v, lenderFinance: undefined }, vehicle).back, 0);
});
test("each payment option preserves its lender approval and follows the selected customer rate", () => {
  const draft = deskingDraft(v, true);
  assert.equal(selectedDeskingValues(draft).lenderFinance?.buyRate, 14);
  const other = selectedDeskingValues({ ...draft, selectedOption: 0 });
  assert.equal(other.lenderFinance, undefined);
  assert.equal(lenderFinanceMath(other).reserve, 0);
  const back = selectedDeskingValues({
    ...draft,
    selectedOption: 2,
    selectedDown: 1,
  });
  assert.equal(back.downPayment, 500);
  assert.equal(back.lenderFinance?.buyRate, 14);
  assert.ok(quoteSchema.safeParse(back).success);
  assert.equal(
    quoteSchema.safeParse({ ...back, lenderFinance: { ...f, buyRate: 7 } })
      .success,
    false,
  );
  for (const bad of [
    { buyRate: 51 },
    { buyRate: -1 },
    { payoutPercent: 101 },
    { lenderFees: -1 },
    { reserveOverride: -1 },
  ])
    assert.equal(
      quoteSchema.safeParse({ ...v, lenderFinance: { ...f, ...bad } }).success,
      false,
    );
});
test("sold deals freeze reserve and fees and use actual accounting for profit and commissions", () => {
  let ws = demoWorkspace();
  const o = ws.opportunities.find((o) => o.status === "working")!;
  o.vehicle_details = { ...ws.inventory[0], ...vehicle, price: 20000 };
  o.inventory_id = null;
  o.vehicle_interest = "Test vehicle";
  o.trade = null;
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: o.customer_id,
    opportunity_id: o.id,
    vehicle: "Test vehicle",
    values: v,
  });
  ws = demoCommand(ws, {
    type: "close_opportunity",
    id: o.id,
    outcome: "sold",
  });
  const sale = ws.sales!.find(
    (s) => s.opportunity_id === o.id && s.status === "sold",
  )!;
  assert.equal(sale.accounting.finance_reserve, 944.55);
  assert.equal(sale.accounting.lender_fees, 300);
  assert.equal(saleMath(sale).front, 7200);
  assert.equal(defaultCommission(sale, "sales"), 1800);
  assert.equal(defaultCommission(sale, "fi"), 47.23);
  const actual = {
    ...sale,
    accounting: { ...sale.accounting, finance_reserve: 700, lender_fees: 250 },
  };
  assert.equal(saleMath(actual).front, 7250);
  assert.equal(saleMath(actual).back, 700);
  assert.equal(
    saleMath({ ...sale, accounting: { ...emptyAccounting } }).back,
    0,
    "old accounting stays authoritative",
  );
});
test("customer quotes, emails and menus exclude lender terms and internal amounts", () => {
  const ws = demoWorkspace();
  const quote = { ...ws.quotes[0], values: { ...v, fiMenu: newFIMenu() } };
  const customer = ws.customers[0];
  const outputs = [
    JSON.stringify(customerQuoteLines(quote, customer)),
    renderToStaticMarkup(
      createElement(PriceQuotePrint, {
        customer,
        quote,
        dealership: ws.org.name,
      }),
    ),
    renderToStaticMarkup(
      createElement(FIMenuPrint, {
        customer,
        quote,
        dealership: ws.org.name,
        acceptance: false,
      }),
    ),
  ];
  for (const output of outputs)
    assert.doesNotMatch(
      output,
      /PRIVATE-BANK-NAME|buyRate|payoutPercent|lenderFees|reserveOverride|Bank reserve|Lender fees|944\.55/i,
    );
  ws.member.role = "sales";
  ws.quotes = [quote];
  ws.opportunities[0].sale_snapshot = {
    ...ws.opportunities[0].sale_snapshot!,
    quote,
  };
  assert.doesNotMatch(
    JSON.stringify(restrictWorkspace(ws)),
    /PRIVATE-BANK-NAME|buyRate|payoutPercent|lenderFees|reserveOverride/,
  );
});
