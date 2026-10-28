import test from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace } from "../lib/demo";
import { seedOperations } from "../lib/operations-demo";
import { seedTitleClerk } from "../lib/title-clerk-demo";
import {
  pendingTitleTotals,
  titleAmounts,
  titleAmountsNeedReview,
} from "../lib/title-clerk-money";
import { demoCommand, commandSchema } from "../lib/model";
import type { FinanceValues } from "../lib/finance";
import type { TitleStatus } from "../lib/title-clerk";

const values: FinanceValues = {
  price: 10000,
  docFee: 499,
  tax: 999,
  titleFee: 125.75,
  tradeAllowance: 1000,
  addOns: 200,
  otherTaxes: 12.34,
  taxMode: "auto",
  payoff: 0,
  downPayment: 0,
  apr: 0,
  months: 60,
  acv: 0,
  recon: 0,
};
function fixture() {
  const ws = seedTitleClerk(seedOperations(demoWorkspace()));
  const c = ws.title_cases![0];
  const sale = ws.sales!.find((s) => s.id === c.sale_id)!;
  const o = ws.opportunities.find((o) => o.id === c.opportunity_id)!;
  const quote = structuredClone(ws.quotes[0]);
  quote.values = { ...values };
  sale.snapshot.quote = quote;
  o.sale_snapshot!.quote = structuredClone(quote);
  ws.title_cases = [c];
  return { ws, c, sale, o, quote };
}
test("DMV totals use saved title fees plus auto highway-use and other taxes, excluding dealer fees", () => {
  const { ws, c, quote } = fixture();
  assert.deepEqual(titleAmounts(ws, c), {
    fees: 125.75,
    taxes: 303.31,
    total: 429.06,
  });
  quote.values.taxMode = "manual";
  quote.values.tax = 40;
  assert.deepEqual(titleAmounts(ws, c), {
    fees: 125.75,
    taxes: 52.34,
    total: 178.09,
  });
  delete quote.values.taxMode;
  assert.equal(titleAmounts(ws, c).taxes, 52.34);
});
test("a later customer, quote or opportunity edit cannot change saved sale amounts", () => {
  const { ws, c, o } = fixture();
  ws.quotes[0].values.titleFee = 9000;
  o.sale_snapshot!.quote!.values.titleFee = 8000;
  assert.equal(titleAmounts(ws, c).fees, 125.75);
});
test("every unfinished status counts; complete and unwound sales leave the tally", () => {
  const { ws, c, sale } = fixture();
  for (const status of [
    "sold",
    "ready",
    "at_dmv",
    "pending",
  ] as TitleStatus[]) {
    c.status = status;
    assert.equal(pendingTitleTotals(ws).count, 1);
    assert.equal(pendingTitleTotals(ws).total, 429.06);
  }
  c.status = "complete";
  assert.equal(pendingTitleTotals(ws).total, 0);
  c.status = "pending";
  sale.status = "unwound";
  assert.equal(pendingTitleTotals(ws).count, 0);
});
test("zero is a recorded amount; missing and invalid figures remain visibly unknown", () => {
  const { ws, c, quote, sale } = fixture();
  quote.values = {
    ...values,
    taxMode: "manual",
    tax: 0,
    titleFee: 0,
    otherTaxes: 0,
  };
  assert.deepEqual(titleAmounts(ws, c), { fees: 0, taxes: 0, total: 0 });
  delete (quote.values as Partial<FinanceValues>).titleFee;
  assert.deepEqual(titleAmounts(ws, c), { fees: null, taxes: 0, total: null });
  assert.equal(pendingTitleTotals(ws).missingDeals, 1);
  assert.equal(pendingTitleTotals(ws).fees, null);
  quote.values.titleFee = NaN;
  quote.values.tax = -1;
  assert.equal(titleAmounts(ws, c).taxes, null);
  sale.snapshot.quote = null;
  assert.deepEqual(titleAmounts(ws, c), {
    fees: null,
    taxes: null,
    total: null,
  });
  assert.equal(pendingTitleTotals(ws).total, null);
});
test("salesperson safe-ledger fallback stays scoped to their active sale and assignment", () => {
  const { ws, c, sale, o } = fixture();
  delete (sale as Partial<typeof sale>).snapshot;
  ws.member.role = "sales";
  o.assigned_to = ws.member.staff_id;
  assert.equal(titleAmounts(ws, c).total, 429.06);
  assert.equal(pendingTitleTotals(ws).count, 1);
  o.assigned_to = "different-staff";
  assert.equal(pendingTitleTotals(ws).count, 0);
  sale.status = "unwound";
  assert.equal(titleAmounts(ws, c).total, null);
  sale.status = "sold";
  o.status = "working";
  assert.equal(titleAmounts(ws, c).total, null);
});
test("totals add integer cents and expose partial subtotals without treating missing fees as zero", () => {
  const { ws, c, sale, quote } = fixture();
  quote.values = {
    ...values,
    titleFee: 0.1,
    taxMode: "manual",
    tax: 0.2,
    otherTaxes: 0,
  };
  for (let n = 1; n < 4; n++) {
    ws.sales!.push({ ...structuredClone(sale), id: `sale-${n}` });
    ws.title_cases!.push({
      ...structuredClone(c),
      id: `case-${n}`,
      sale_id: `sale-${n}`,
    });
  }
  assert.deepEqual(pendingTitleTotals(ws), {
    count: 4,
    fees: 0.4,
    taxes: 0.8,
    total: 1.2,
    missingFees: 0,
    missingTaxes: 0,
    missingDeals: 0,
  });
  ws.sales!.find((s) => s.id === "sale-3")!.snapshot.quote = null;
  assert.deepEqual(pendingTitleTotals(ws), {
    count: 4,
    fees: 0.3,
    taxes: 0.6,
    total: 0.9,
    missingFees: 1,
    missingTaxes: 1,
    missingDeals: 1,
  });
});

test("three title files with unconfirmed zeros count reviewed corrections once and preserve the original sale", () => {
  const { ws, c, sale, quote } = fixture();
  quote.values = {
    ...values,
    price: 4500,
    docFee: 399,
    taxMode: "manual",
    tax: 0,
    titleFee: 0,
    tradeAllowance: 0,
    addOns: 0,
    otherTaxes: 0,
  };
  for (let n = 1; n < 3; n++) {
    const nextSale = { ...structuredClone(sale), id: `sale-${n}` };
    nextSale.snapshot.quote!.values = {
      ...quote.values,
      tax: n === 1 ? 149.61 : 146.97,
      titleFee: n === 1 ? 114 : 0,
    };
    ws.sales!.push(nextSale);
    ws.title_cases!.push({
      ...structuredClone(c),
      id: `case-${n}`,
      sale_id: nextSale.id,
    });
  }
  assert.deepEqual(
    [
      pendingTitleTotals(ws).fees,
      pendingTitleTotals(ws).taxes,
      pendingTitleTotals(ws).total,
    ],
    [114, 296.58, 410.58],
  );
  assert.equal(
    ws.title_cases!.filter((c) => titleAmountsNeedReview(ws, c)).length,
    2,
  );
  const original = JSON.stringify(ws.sales);
  c.amounts = { fees: 114, taxes: 146.97, note: "Verified title packet" };
  ws.title_cases![2].amounts = { ...c.amounts };
  assert.deepEqual(
    [
      pendingTitleTotals(ws).fees,
      pendingTitleTotals(ws).taxes,
      pendingTitleTotals(ws).total,
    ],
    [342, 443.55, 785.55],
  );
  assert.equal(
    ws.title_cases!.filter((c) => titleAmountsNeedReview(ws, c)).length,
    0,
  );
  assert.equal(JSON.stringify(ws.sales), original);
  ws.title_cases![2].amounts!.fees = 75;
  assert.equal(
    pendingTitleTotals(ws).fees,
    303,
    "Fees are per-deal amounts, never count multiplied by a fixed fee",
  );
  c.amounts = { fees: 0, taxes: 0, note: "Confirmed exemption" };
  assert.equal(titleAmountsNeedReview(ws, c), false);
  assert.equal(pendingTitleTotals(ws).fees, 189);
});

test("demo amount review enforces manager permission, stale revisions, validation and history", () => {
  let { ws, c } = fixture();
  const command = {
    type: "save_title_amounts",
    id: c.id,
    revision: c.revision,
    values: { fees: 114, taxes: 146.97, note: "Verified packet" },
  } as const;
  assert(commandSchema.safeParse(command).success);
  for (const values of [
    { ...command.values, note: " " },
    { ...command.values, taxes: -1 },
    { ...command.values, fees: 0.001 },
    { ...command.values, fees: "114" },
  ])
    assert(!commandSchema.safeParse({ ...command, values }).success);
  const sold = JSON.stringify(ws.sales),
    quotes = JSON.stringify(ws.quotes);
  ws = demoCommand(ws, command);
  assert.deepEqual(ws.title_cases![0].amounts, command.values);
  assert.equal(JSON.stringify(ws.sales), sold);
  assert.equal(JSON.stringify(ws.quotes), quotes);
  assert(
    ws.title_events!.some(
      (e) =>
        e.case_id === c.id &&
        e.event === "DMV amounts reviewed" &&
        (e.detail.after as any).fees === 114,
    ),
  );
  assert.throws(() => demoCommand(ws, command), /Record changed/);
  ws.member.role = "sales";
  ws.opportunities.find((o) => o.id === c.opportunity_id)!.assigned_to =
    ws.member.staff_id;
  assert.throws(
    () => demoCommand(ws, { ...command, revision: c.revision + 1 }),
    /Manager required/,
  );
});
