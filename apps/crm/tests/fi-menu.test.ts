import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  defaultQuote,
  demoCommand,
  quoteMath,
  type Quote,
  type Workspace,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  fiMenuSchema,
  newFIMenu,
  cloneFIMenu,
  fiOptionValues,
  fiSelectionMatches,
  clearFISelection,
  customerFIProduct,
  fiBillOfSale,
  fiPresentationKey,
} from "../lib/fi-menu";
import { type FIProduct, saleMath } from "../lib/operations";
import { clearFIPaperwork } from "../lib/fi-paperwork";
import { documentContext, formValues, soldForms } from "../lib/documents";
import { buildSoldPack } from "../lib/pdf-output";
import { FIMenuPrint } from "../components/FIMenuPrint";

const products: FIProduct[] = [
  "service_contract",
  "gap",
  "maintenance",
  "tire_wheel",
  "pdr",
  "appearance",
  "key_replacement",
  "other",
].map((kind, i) => ({
  id: crypto.randomUUID(),
  kind: kind as FIProduct["kind"],
  name: i === 0 ? "Sample vehicle protection" : undefined,
  provider: "Sample provider",
  description: "Coverage summary for the customer.",
  contract_number: "PRIVATE-CONTRACT-REFERENCE",
  term_months: 36,
  mileage_limit: 36000,
  deductible: 100,
  cost: 317 + i,
  price: 1000 + i * 100,
  notes: "PRIVATE STAFF NOTES",
}));
const menu = newFIMenu(products);
const base = {
  ...defaultQuote,
  mode: "finance" as const,
  taxMode: "auto" as const,
  price: 20000,
  titleFee: 150,
  tradeAllowance: 3000,
  payoff: 1000,
  downPayment: 2000,
  apr: 8,
  months: 60,
  daysToFirstPayment: 45,
  products: [products[0]],
  serviceContract: 1000,
};

test("four-option menu replaces current products, keeps financing fixed, and supports cash, zero APR and decline", () => {
  assert.equal(menu.packages.length, 4);
  for (const [index, n] of [
    [0, 8],
    [1, 7],
    [2, 4],
    [3, 1],
  ]) {
    const values = fiOptionValues(base, menu, index);
    assert.equal(values.products!.length, n);
    assert.equal(values.apr, base.apr);
    assert.equal(values.months, base.months);
    assert.equal(values.downPayment, base.downPayment);
    assert.equal(
      values.serviceContract,
      products.slice(0, n).reduce((s, p) => s + p.price, 0),
    );
    assert.equal(
      quoteMath(values).total -
        quoteMath(fiOptionValues(base, menu, "declined")).total,
      values.serviceContract,
    );
    assert(fiSelectionMatches(values));
    assert.equal(
      commandSchema.safeParse({
        type: "save_quote",
        customer_id: crypto.randomUUID(),
        vehicle: "Sample car",
        values,
      }).success,
      true,
    );
  }
  const declined = fiOptionValues(base, menu, "declined");
  assert.deepEqual(declined.products, []);
  assert.equal(declined.serviceContract, 0);
  assert(fiSelectionMatches(declined));
  const cash = fiOptionValues({ ...base, mode: "cash", apr: 0 }, menu, 2);
  assert.equal(quoteMath(cash).balance, quoteMath(cash).total - 2000);
  const zero = fiOptionValues({ ...base, apr: 0, months: 36 }, menu, 3);
  assert.equal(
    quoteMath(zero).payment,
    Math.round((quoteMath(zero).balance / 36) * 100) / 100,
  );
  const changed = { ...zero, products: [] };
  assert.equal(fiSelectionMatches(changed), false);
  assert.equal(
    commandSchema.safeParse({
      type: "save_quote",
      customer_id: crypto.randomUUID(),
      vehicle: "Sample car",
      values: changed,
    }).success,
    false,
  );
  assert.equal(clearFISelection(changed).fiMenu?.selected, null);
  assert.notEqual(
    fiPresentationKey(zero),
    fiPresentationKey({ ...zero, price: 19999 }),
  );
  const copied = cloneFIMenu({
    ...menu,
    selected: 0,
    customer_name: "Previous customer",
  });
  assert.equal(copied.customer_name, undefined);
  assert.equal(copied.selected, null);
  assert(
    copied.products.every(
      (p) =>
        !p.contract_number &&
        !p.notes &&
        !products.some((old) => old.id === p.id),
    ),
  );
  assert(fiMenuSchema.safeParse(copied).success);
  for (const invalid of [
    { ...menu, packages: menu.packages.slice(0, 3) },
    { ...menu, selected: 4 },
    { ...menu, products: [...products, products[0]] },
    {
      ...menu,
      packages: [
        { ...menu.packages[0], product_ids: [crypto.randomUUID()] },
        ...menu.packages.slice(1),
      ],
    },
  ])
    assert.equal(fiMenuSchema.safeParse(invalid).success, false);
});

test("customer menu/acceptance allow only public fields; bill-of-sale categories add up without duplicating service contracts", async () => {
  const ws = demoWorkspace(),
    c = ws.customers[0],
    op = ws.opportunities.find((o) => o.customer_id === c.id)!;
  const values = fiOptionValues(base, menu, 0);
  const q: Quote = {
    ...ws.quotes[0],
    id: crypto.randomUUID(),
    customer_id: c.id,
    opportunity_id: op.id,
    vehicle: op.vehicle_interest,
    inventory_id: op.inventory_id,
    values,
    created_at: new Date().toISOString(),
  };
  for (const acceptance of [true, false]) {
    const html = renderToStaticMarkup(
      createElement(FIMenuPrint, {
        quote: q,
        customer: c,
        dealership: ws.org.name,
        acceptance,
      }),
    );
    assert(html.includes("Sample vehicle protection"));
    assert(
      !/PRIVATE STAFF NOTES|PRIVATE-CONTRACT-REFERENCE|Provider cost|Gross · internal|\$317\.00/.test(
        html,
      ),
    );
    assert(html.includes(acceptance ? "Accepted coverage" : "Option A"));
  }
  const safe = customerFIProduct(products[0]);
  assert.equal("cost" in safe, false);
  assert.equal("notes" in safe, false);
  const figures = fiBillOfSale(values);
  assert.equal(figures.service_contract, 1000);
  assert.equal(figures.gap, 1100);
  assert.equal(figures.prepaid_maintenance, 1200);
  assert.equal(figures.tire_wheel, 1300);
  assert.equal(figures.optional_products_total, 10800);
  assert.equal(
    figures.service_contract +
      figures.gap +
      figures.prepaid_maintenance +
      figures.tire_wheel +
      figures.other_product_1 +
      figures.other_product_2,
    figures.optional_products_total,
  );
  op.status = "working";
  ws.quotes = [q];
  const context = documentContext(ws, c, op),
    form = soldForms.find((f) => f.id === "bill-of-sale")!;
  const mapped = formValues(form, context, {});
  assert.equal(mapped.service_contract, "1000.00");
  assert.equal(mapped.gap, "1100.00");
  assert.equal(mapped.optional_products_total, "10800.00");
  assert.equal(mapped.other_product_1, "1400.00");
  assert.equal(mapped.other_product_2, "4800.00");
  assert.equal(Number(mapped.balance_due), quoteMath(values).balance);
  const pdf = await buildSoldPack(
    context,
    {},
    (spec) =>
      fs.readFile(new URL("../assets/forms/" + spec.file, import.meta.url)),
    [form],
  );
  assert(pdf.byteLength > 5000);
});

test("demo menu selections preserve versions and refresh only quote-derived paperwork corrections", () => {
  let ws = demoWorkspace();
  const op = ws.opportunities.find((o) => o.status === "working")!;
  op.paperwork = {
    $common: { "deal.balance": "STALE", "buyer.name": "Keep buyer correction" },
    "bill-of-sale": {
      service_contract: "STALE",
      gap: "STALE",
      other_product_1: "STALE",
      warranty_as_is: true,
    },
    insurance: { agent_name: "Keep agent" },
  };
  const old = structuredClone(op.paperwork),
    count = ws.quotes.length;
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: op.customer_id,
    opportunity_id: op.id,
    vehicle: op.vehicle_interest,
    values: fiOptionValues(base, menu, 1),
  });
  assert.equal(ws.quotes.length, count + 1);
  assert(ws.quotes[0].values.fiMenu?.customer_name);
  assert.deepEqual(
    ws.opportunities.find((o) => o.id === op.id)!.paperwork,
    clearFIPaperwork(old),
  );
  const first = structuredClone(ws.quotes[0]);
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: op.customer_id,
    opportunity_id: op.id,
    vehicle: op.vehicle_interest,
    values: fiOptionValues(base, menu, "declined"),
  });
  assert.deepEqual(ws.quotes[1], first);
  assert.equal(ws.quotes[0].values.serviceContract, 0);
});

test("008 validates menus in every quote path, freezes selections and identity, scopes access and clears stale paperwork", async () => {
  const pg = new PGlite(),
    org = "d5a1c100-0000-4000-8000-000000000001",
    actor = "00000000-0000-4000-8000-000000000099";
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (p: unknown, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        actor,
        JSON.stringify(p),
      ])
    ).id as string;
  const customer = {
    name: "Menu Test Buyer",
    email: "",
    phone: "",
    source: "Walk-in",
    status: "new",
    vehicle_interest: "Sample vehicle",
    trade_vehicle: "",
    birthday: null,
  };
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${actor}','owner@example.invalid');insert into public.staff values('${actor}','Test Owner',true,'owner');`,
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^00[1-7]_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const cid = await cmd({ type: "create_customer", customer }),
      op = await one("select * from dmcrm_opportunities where customer_id=$1", [
        cid,
      ]);
    const oldId = await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: op.id,
      vehicle: "Sample vehicle",
      values: { ...defaultQuote, price: 20000 },
    });
    const oldQuote = await one("select * from dmcrm_quotes where id=$1", [
      oldId,
    ]);
    await pg.exec(
      await fs.readFile(
        new URL("../db/008_fi_menus.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      await one("select * from dmcrm_quotes where id=$1", [oldId]),
      oldQuote,
    );
    const corrections = {
      $common: { "deal.balance": "999999", "buyer.name": "Keep name" },
      "bill-of-sale": {
        service_contract: "999999",
        gap: "8888",
        other_product_1: "7777",
        warranty_as_is: true,
      },
    };
    await cmd({
      type: "save_paperwork",
      opportunity_id: op.id,
      revision: 0,
      paperwork: corrections,
    });
    const request = {
      type: "save_quote",
      customer_id: cid,
      opportunity_id: op.id,
      vehicle: "Sample vehicle",
      values: fiOptionValues(
        base,
        { ...menu, customer_name: "Spoofed identity" },
        0,
      ),
    };
    const qid = await cmd(request),
      q = await one("select * from dmcrm_quotes where id=$1", [qid]);
    assert.equal(q.values.fiMenu.customer_name, customer.name);
    assert.equal(q.values.products.length, 8);
    assert.equal(q.values.serviceContract, 10800);
    assert.equal(q.values.products[6].kind, "key_replacement");
    const savedOp = await one("select * from dmcrm_opportunities where id=$1", [
      op.id,
    ]);
    assert.deepEqual(savedOp.paperwork, clearFIPaperwork(corrections));
    assert.equal(savedOp.paperwork_revision, 2);
    await assert.rejects(
      cmd({
        type: "save_paperwork",
        opportunity_id: op.id,
        revision: 1,
        paperwork: corrections,
      }),
      /changed in another session/,
    );
    for (const bad of [
      { ...request.values, products: [] },
      { ...request.values, fiMenu: { ...menu, selected: 9 } },
      {
        ...request.values,
        fiMenu: {
          ...menu,
          selected: null,
          packages: menu.packages.slice(0, 3),
        },
      },
      {
        ...request.values,
        fiMenu: {
          ...menu,
          selected: null,
          packages: [
            { ...menu.packages[0], product_ids: [crypto.randomUUID()] },
            ...menu.packages.slice(1),
          ],
        },
      },
    ])
      await assert.rejects(cmd({ ...request, values: bad }), /F&I/);
    assert.equal((await one("select count(*)::int n from dmcrm_quotes")).n, 2);
    await assert.rejects(cmd(request, crypto.randomUUID()), /membership/i);
    const quick = await cmd({
      type: "convert_quick_quote",
      id: crypto.randomUUID(),
      customer: { ...customer, name: "Quick Menu Buyer" },
      quote: {
        inventory_id: null,
        vehicle: "Sample car",
        values: fiOptionValues(
          { ...base, tradeAllowance: 0, acv: 0, payoff: 0 },
          menu,
          0,
        ),
      },
    });
    const quickQuote = await one(
      "select * from dmcrm_quotes where customer_id=$1",
      [quick],
    );
    assert.equal(quickQuote.values.products[7].kind, "other");
    assert.equal(quickQuote.values.fiMenu.customer_name, "Quick Menu Buyer");
    await cmd({ type: "close_opportunity", id: op.id, outcome: "sold" });
    const sale = await one(
      "select * from dmcrm_sales where opportunity_id=$1",
      [op.id],
    );
    assert.equal(sale.snapshot.quote.values.fiMenu.selected, 0);
    assert.equal(sale.snapshot.quote.values.serviceContract, 10800);
    assert.equal(saleMath(sale).productRevenue, 10800);
    assert.equal(saleMath(sale).productCost, 2564);
    assert.equal(saleMath(sale).productGross, 8236);
    await assert.rejects(cmd(request), /Closed opportunity/);
    await pg.query(
      "update dmcrm_customers set name='Renamed after sale' where id=$1",
      [cid],
    );
    assert.equal(
      (await one("select values from dmcrm_quotes where id=$1", [qid])).values
        .fiMenu.customer_name,
      customer.name,
    );
    await cmd({
      type: "unwind_sale",
      opportunity_id: op.id,
      reason: "Integration test",
    });
    assert.equal(
      (await one("select status from dmcrm_sales where id=$1", [sale.id]))
        .status,
      "unwound",
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      await pg.exec(`set role ${role}`);
      await assert.rejects(
        pg.query("select dmcrm_fi_values($1::jsonb)", [
          JSON.stringify(request.values),
        ]),
        /permission denied/,
      );
      if (role !== "service_role")
        await assert.rejects(cmd(request), /permission denied/);
      await pg.exec("reset role");
    }
  } finally {
    await pg.close();
  }
});
