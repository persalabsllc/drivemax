import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  defaultQuote,
  demoCommand,
  opportunityCustomer,
  quickQuoteSchema,
  quoteMath,
  type Command,
  type Customer,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  deskingDefaults,
  deskingDraft,
  selectedDeskingValues,
} from "../lib/desking";
import { printableQuickQuote } from "../lib/quick-quote";

const owner = "00000000-0000-4000-8000-000000000099",
  sales = "00000000-0000-4000-8000-000000000098",
  outsider = "00000000-0000-4000-8000-000000000097",
  org = "d5a1c100-0000-4000-8000-000000000001";
const customer = {
  name: "Quick Quote Test",
  email: "",
  phone: "",
  source: "Walk-in",
  status: "new" as const,
  vehicle_interest: "",
  trade_vehicle: "",
  birthday: null,
  initial_opportunity: true,
};
const product = {
  id: crypto.randomUUID(),
  kind: "service_contract" as const,
  provider: "Test provider",
  contract_number: "",
  term_months: 36,
  mileage_limit: 36000,
  deductible: 100,
  cost: 450,
  price: 1200,
  notes: "Internal only",
};
const quote = {
  inventory_id: null,
  vehicle: "",
  values: selectedDeskingValues({
    ...deskingDraft(defaultQuote),
    price: 18000,
    titleFee: 150,
    tradeAllowance: 3000,
    payoff: 1000,
    acv: 2700,
    recon: 200,
    products: [product],
    serviceContract: 1200,
    selectedOption: 0,
    selectedDown: 1,
    financeOptions: [
      { months: 36, apr: 0 },
      { months: 48, apr: 7 },
      { months: 60, apr: 8 },
    ],
    downPayments: [1000, 2500, 4000],
  }),
};
const conversion = (): Extract<Command, { type: "convert_quick_quote" }> => ({
  type: "convert_quick_quote",
  id: crypto.randomUUID(),
  customer,
  quote,
});

test("price-only quick quote uses the same selected figures without requiring a customer or vehicle", () => {
  assert.equal(quickQuoteSchema.safeParse(quote).success, true);
  assert.equal(quote.values.apr, 0);
  assert.equal(quote.values.months, 36);
  assert.equal(quote.values.downPayment, 2500);
  const math = quoteMath(quote.values);
  assert.equal(math.tax, 461.97);
  assert.equal(math.total, 18210.97);
  assert.equal(math.balance, 15710.97);
  assert.equal(math.payment, 436.42);
  const print = printableQuickQuote(quote, []);
  assert.equal(print.vehicle, "Vehicle to be selected");
  assert.equal("id" in print, false);
  assert.equal("customer_id" in print, false);
  assert.deepEqual(quoteMath(print.values), math);
  assert.equal(commandSchema.safeParse(conversion()).success, true);
  for (const invalid of [
    { price: -1 },
    { apr: 51 },
    { months: 0 },
    { selectedDown: 3 },
    { price: Infinity },
  ])
    assert.equal(
      quickQuoteSchema.safeParse({
        ...quote,
        values: { ...quote.values, ...invalid },
      }).success,
      false,
    );
});

test("demo conversion preserves manual trade and payment choices, while inventory stays available", () => {
  const before = demoWorkspace();
  const command = conversion();
  const after = demoCommand(before, command);
  assert.equal(after.customers.length, before.customers.length + 1);
  assert.equal(after.opportunities.length, before.opportunities.length + 1);
  assert.equal(after.quotes.length, before.quotes.length + 1);
  const saved = after.quotes[0];
  const linked = opportunityCustomer(
    after.customers[0],
    after.opportunities[0],
  );
  assert.equal(linked.trade_vehicle, "Trade details pending");
  assert.deepEqual(
    quoteMath(deskingDefaults(linked, after.inventory, saved)),
    quoteMath(quote.values),
  );
  assert.equal(
    demoCommand(after, command).customers.length,
    after.customers.length,
  );
  assert.equal(before.quick_quote_conversions, undefined);
  assert.throws(
    () =>
      demoCommand(after, {
        type: "close_opportunity",
        id: after.opportunities[0].id,
        outcome: "sold",
      }),
    /Complete the trade vehicle details/,
  );
  const vehicle = before.inventory.find((v) => v.status === "in_stock")!;
  const stockCommand = {
    ...conversion(),
    quote: {
      ...quote,
      inventory_id: vehicle.id,
      vehicle: "Untrusted description",
    },
  };
  const stock = demoCommand(before, stockCommand);
  assert.equal(stock.quotes[0].inventory_id, vehicle.id);
  assert.notEqual(stock.quotes[0].vehicle, "Untrusted description");
  assert.deepEqual(stock.inventory, before.inventory);
  vehicle.status = "sold";
  assert.throws(() => demoCommand(before, stockCommand), /no longer in stock/);
  assert.throws(
    () => printableQuickQuote(stockCommand.quote, before.inventory),
    /no longer in stock/,
  );
});

test("007 conversion atomically creates one profile, opportunity and quote; retries and tenant access are safe", async () => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (p: unknown, user = owner, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        user,
        JSON.stringify(p),
      ])
    ).id as string;
  const counts = () =>
    one(
      "select (select count(*)::int from dmcrm_customers) customers,(select count(*)::int from dmcrm_opportunities) opportunities,(select count(*)::int from dmcrm_quotes) quotes,(select count(*)::int from dmcrm_quick_quote_conversions) conversions",
    );
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${outsider}','outsider@example.invalid');insert into public.staff values('${owner}','Test Owner',true,'owner');`,
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^00[1-7]_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Test Sales','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Test Sales','sales@example.invalid','sales');`,
    );
    assert.deepEqual(await counts(), {
      customers: 0,
      opportunities: 0,
      quotes: 0,
      conversions: 0,
    });
    const request = conversion();
    const cid = await cmd(request, sales);
    assert.deepEqual(await counts(), {
      customers: 1,
      opportunities: 1,
      quotes: 1,
      conversions: 1,
    });
    const c = await one("select * from dmcrm_customers where id=$1", [cid]);
    const op = await one(
      "select * from dmcrm_opportunities where customer_id=$1",
      [cid],
    );
    const q = await one("select * from dmcrm_quotes where customer_id=$1", [
      cid,
    ]);
    const staff = await one("select id from dmcrm_staff where user_id=$1", [
      sales,
    ]);
    assert.equal(c.assigned_to, staff.id);
    assert.equal(op.assigned_to, staff.id);
    assert.equal(op.trade_vehicle, "Trade details pending");
    assert.equal(op.trade, null);
    assert.equal(op.vehicle_interest, "Vehicle to be selected");
    assert.equal(q.vehicle, op.vehicle_interest);
    assert.equal(q.values.serviceContract, 1200);
    assert.equal(q.values.products[0].cost, 450);
    assert.deepEqual(
      quoteMath(deskingDefaults(opportunityCustomer(c as Customer, op), [], q)),
      quoteMath(quote.values),
    );
    assert.equal(await cmd(request, sales), cid);
    assert.equal(
      await cmd(
        {
          ...request,
          quote: { ...quote, values: { ...quote.values, price: 99999 } },
        },
        sales,
      ),
      cid,
    );
    assert.deepEqual(await counts(), {
      customers: 1,
      opportunities: 1,
      quotes: 1,
      conversions: 1,
    });
    assert.equal(
      (await one("select values from dmcrm_quotes where id=$1", [q.id])).values
        .price,
      18000,
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from dmcrm_activities where customer_id=$1 and body='Quick quote saved to new customer profile'",
          [cid],
        )
      ).n,
      1,
    );
    await assert.rejects(cmd(request, owner), /conversion unavailable/);
    await assert.rejects(cmd(conversion(), outsider), /membership/);
    const foreignOrg = crypto.randomUUID();
    await pg.exec(
      `insert into dmcrm_orgs(id,name,slug) values('${foreignOrg}','Other dealer','other');insert into dmcrm_members values('${foreignOrg}','${sales}','Test Sales','sales',true);insert into dmcrm_staff(org_id,user_id,name,role) values('${foreignOrg}','${sales}','Test Sales','sales');`,
    );
    await assert.rejects(
      cmd(request, sales, foreignOrg),
      /conversion unavailable/,
    );
    const stockId = await cmd({
      type: "save_inventory",
      vehicle: {
        vin: "1HGCM82633A004352",
        stock_number: "QQ100",
        year: 2018,
        make: "Honda",
        model: "Accord",
        trim: "EX",
        mileage: 80000,
        color: "Blue",
        cost: 10000,
        recon: 500,
        price: 20000,
        acquired_on: "2026-10-01",
        status: "in_stock",
      },
    });
    const stockRequest = {
      ...conversion(),
      quote: {
        ...quote,
        inventory_id: stockId,
        vehicle: "Fake vehicle",
        values: {
          ...quote.values,
          tradeAllowance: 0,
          acv: 0,
          payoff: 0,
          recon: 0,
        },
      },
    };
    const stockCid = await cmd(stockRequest);
    const stockQuote = await one(
      "select * from dmcrm_quotes where customer_id=$1",
      [stockCid],
    );
    assert.equal(stockQuote.vehicle, "2018 Honda Accord EX");
    assert.equal(stockQuote.vehicle_details.cost, 10000);
    assert.equal(stockQuote.values.price, 18000); // negotiated price is retained
    assert.equal(
      (await one("select status from dmcrm_inventory where id=$1", [stockId]))
        .status,
      "in_stock",
    );
    await assert.rejects(
      cmd({ type: "close_opportunity", id: op.id, outcome: "sold" }, sales),
      /Complete the trade vehicle details/,
    );
    assert.equal(
      (await one("select status from dmcrm_opportunities where id=$1", [op.id]))
        .status,
      "working",
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from dmcrm_sales where opportunity_id=$1",
          [op.id],
        )
      ).n,
      0,
    );
    const beforeFailure = await counts();
    await assert.rejects(
      cmd({ ...stockRequest, id: crypto.randomUUID() }, sales, foreignOrg),
      /Vehicle unavailable/,
    );
    await cmd({
      type: "close_opportunity",
      id: stockQuote.opportunity_id,
      outcome: "sold",
    });
    assert.equal(
      (await one("select status from dmcrm_inventory where id=$1", [stockId]))
        .status,
      "sold",
    );
    await assert.rejects(
      cmd({ ...stockRequest, id: crypto.randomUUID() }),
      /in-stock/,
    );
    // Failing the last step must roll back the preceding customer and opportunity too.
    await assert.rejects(
      cmd({
        ...conversion(),
        quote: {
          ...quote,
          values: {
            ...quote.values,
            products: [{ ...product, kind: "invalid" }],
          },
        },
      }),
      /Invalid F&I/,
    );
    assert.deepEqual(await counts(), beforeFailure);
    assert.equal(await cmd(stockRequest), stockCid); // retry still succeeds after the stock later sells
    await pg.query("update dmcrm_staff set active=false where user_id=$1", [
      sales,
    ]);
    await assert.rejects(cmd(request, sales), /membership/);
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      await assert.rejects(
        pg.query("select * from dmcrm_quick_quote_conversions"),
        /permission denied/,
      );
      await assert.rejects(cmd(conversion()), /permission denied/);
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    await assert.rejects(
      pg.query("select dmcrm_command_v6($1,$2,$3::jsonb)", [
        org,
        owner,
        JSON.stringify(conversion()),
      ]),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});
