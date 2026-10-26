import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  defaultQuote,
  demoCommand,
  type Opportunity,
  type Workspace,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  emptyAccounting,
  saleMath,
  searchDeals,
  distanceMiles,
  csvText,
  type Sale,
  type TradeIntake,
  type FIProduct,
  type SearchFilters,
  type Commission,
} from "../lib/operations";
import { blankPerson } from "../lib/people";

const owner = "00000000-0000-4000-8000-000000000099",
  actor = "00000000-0000-4000-8000-000000000098",
  org = "d5a1c100-0000-4000-8000-000000000001";
const product: FIProduct = {
  id: crypto.randomUUID(),
  kind: "service_contract",
  provider: "Sample Provider",
  contract_number: "TEST",
  term_months: 36,
  mileage_limit: 36000,
  deductible: 100,
  cost: 600,
  price: 1500,
  notes: "",
};
const vehicle = {
  vin: "1HGCM82633A004352",
  stock_number: "DM104",
  year: 2018,
  make: "Honda",
  model: "Accord",
  trim: "EX",
  mileage: 80000,
  color: "Blue",
  cost: 10000,
  recon: 500,
  price: 14000,
  acquired_on: "2025-10-01",
  status: "in_stock",
};
const trade = {
  vin: "1FTFW1EF1EKE12345",
  year: 2014,
  make: "Ford",
  model: "F150",
  trim: "XLT",
  mileage: 140000,
  allowance: 4000,
  acv: 3500,
  payoff: 2000,
  description: "2014 Ford F150",
};
const customer = {
  name: "Sample Buyer",
  email: "buyer@example.invalid",
  phone: "2525550101",
  source: "Walk-in",
  status: "new",
  vehicle_interest: "Honda",
  trade_vehicle: "",
  birthday: null,
  initial_opportunity: false,
  person: {
    ...blankPerson,
    first_name: "Sample",
    last_name: "Buyer",
    zip: "28562",
  },
};
const values = {
  ...defaultQuote,
  price: 14000,
  docFee: 399,
  serviceContract: 99999,
  products: [product],
  addOns: 200,
  tradeAllowance: 4000,
  acv: 3500,
  payoff: 2000,
};
const editableTrade = (t: TradeIntake, status = "retail") => ({
  ...t,
  status,
  wholesale_on: t.wholesale_on ?? "",
  wholesale_price: t.wholesale_price ?? null,
});

test("005 sale ledger backfill, trade intake, accounting revisions, unwind and resale are atomic and retain history", async () => {
  const pg = new PGlite();
  const one = async <T = any>(sql: string, args: unknown[] = []) =>
    (await pg.query<T>(sql, args)).rows[0];
  const cmd = async (p: unknown, user = owner, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        user,
        JSON.stringify(p),
      ])
    ).id;
  const row = async <T = any>(table: string, id: string) =>
    one<T>(`select * from dmcrm_${table} where id=$1`, [id]);
  const count = async (sql: string, args: unknown[] = []) =>
    (await one("select count(*)::int n " + sql, args)).n;
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}','owner@example.invalid'),('${actor}','sales@example.invalid');insert into public.staff values('${owner}','Test Owner',true,'owner');`,
    );
    for (const f of [
      "001_crm.sql",
      "002_inventory_desking.sql",
      "003_opportunities_documents.sql",
      "004_team_assignments.sql",
    ])
      await pg.exec(
        await fs.readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const cid = await cmd({ type: "create_customer", customer });
    const inventory = await cmd({ type: "save_inventory", vehicle });
    const op = await cmd({
      type: "create_opportunity",
      customer_id: cid,
      opportunity: {
        title: "Test purchase",
        status: "working",
        source: "Walk-in",
        inventory_id: inventory,
        vehicle_interest: "2018 Honda Accord",
        vehicle_details: null,
        trade_vehicle: trade.description,
        trade,
      },
    });
    // Create a legacy sale before 005 to verify recovery of existing trades.
    await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: op,
      vehicle: "2018 Honda Accord",
      values: { ...values, serviceContract: 1500 },
    });
    await cmd({ type: "close_opportunity", id: op, outcome: "sold" });
    const original = (await row<Opportunity>("opportunities", op))
      .sale_snapshot;
    await pg.exec(
      await fs.readFile(
        new URL("../db/005_deal_operations.sql", import.meta.url),
        "utf8",
      ),
    );
    const staff = (
      await one("select id from dmcrm_staff where user_id=$1", [owner])
    ).id;
    const salesStaff = await cmd({
      type: "save_staff",
      staff: {
        name: "Test Sales",
        email: "sales@example.invalid",
        role: "sales",
      },
    });
    await pg.query("select dmcrm_create_staff_invite($1,$2,$3,$4)", [
      org,
      owner,
      salesStaff,
      "a".repeat(64),
    ]);
    await pg.query("select dmcrm_claim_staff_invite($1,$2,$3)", [
      "a".repeat(64),
      actor,
      "sales@example.invalid",
    ]);
    const sale = await one<Sale>(
      "select * from dmcrm_sales where opportunity_id=$1",
      [op],
    );
    let intake = await one<TradeIntake>(
      "select * from dmcrm_trades where sale_id=$1",
      [sale.id],
    );
    assert.equal(intake.stock_number, "DM104A");
    assert.equal(Number(intake.cost), 3500);
    assert.equal(intake.status, "received");
    assert.deepEqual(sale.snapshot.quote, original?.quote);
    await cmd({ type: "close_opportunity", id: op, outcome: "sold" });
    assert.equal(
      await count("from dmcrm_sales where opportunity_id=$1", [op]),
      1,
    );
    await assert.rejects(
      cmd(
        { type: "unwind_sale", opportunity_id: op, reason: "Incorrect sale" },
        actor,
      ),
      /Manager access/,
    );
    await assert.rejects(
      cmd(
        {
          type: "update_trade_intake",
          id: intake.id,
          revision: 0,
          trade: editableTrade(intake),
        },
        actor,
      ),
      /Manager access/,
    );
    await cmd({
      type: "update_trade_intake",
      id: intake.id,
      revision: 0,
      trade: editableTrade(intake),
    });
    intake = await row("trades", intake.id);
    assert.equal(
      (await row("inventory", intake.inventory_id!)).status,
      "in_stock",
    );
    await assert.rejects(
      cmd({
        type: "update_trade_intake",
        id: intake.id,
        revision: 0,
        trade: editableTrade(intake),
      }),
      /another session/,
    );
    const commission = {
      id: crypto.randomUUID(),
      staff_id: staff,
      category: "sales",
      amount: 500,
      paid_amount: 200,
      paid_on: "2026-10-26",
      notes: "",
    };
    const accounting = {
      ...emptyAccounting,
      finance_reserve: 250,
      accessory_cost: 100,
      pack: 400,
    };
    await cmd({
      type: "save_accounting",
      sale_id: sale.id,
      revision: 0,
      accounting,
      commissions: [commission],
    });
    await assert.rejects(
      cmd({
        type: "save_accounting",
        sale_id: sale.id,
        revision: 0,
        accounting,
        commissions: [commission],
      }),
      /another session/,
    );
    await assert.rejects(
      cmd({
        type: "save_accounting",
        sale_id: sale.id,
        revision: 1,
        accounting,
        commissions: [],
      }),
      /paid commissions/,
    );
    assert.equal(
      await count("from dmcrm_accounting_history where sale_id=$1", [sale.id]),
      1,
    );
    await cmd({
      type: "unwind_sale",
      opportunity_id: op,
      reason: "Customer financing fell through",
    });
    assert.equal((await row("inventory", inventory)).status, "in_stock");
    assert.equal(
      (await row("inventory", intake.inventory_id!)).status,
      "archived",
    );
    assert.equal((await row("trades", intake.id)).status, "returned");
    const reversed = await row<Sale>("sales", sale.id);
    assert.equal(reversed.status, "unwound");
    assert.deepEqual(reversed.snapshot, sale.snapshot);
    assert.equal((await row("opportunities", op)).status, "working");
    assert.equal(
      await count(
        "from dmcrm_tasks where opportunity_id=$1 and kind in('sold_followup','anniversary') and completed_at is null and canceled_at is null",
        [op],
      ),
      0,
    );
    assert.equal(
      await count(
        "from dmcrm_activities where opportunity_id=$1 and body like 'Sold deal unwound:%'",
        [op],
      ),
      1,
    );
    await assert.rejects(
      cmd({
        type: "unwind_sale",
        opportunity_id: op,
        reason: "Duplicate click",
      }),
      /currently sold/,
    );
    await assert.rejects(
      cmd({
        type: "save_accounting",
        sale_id: sale.id,
        revision: 2,
        accounting,
        commissions: [commission],
      }),
      /read-only/,
    );
    await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: op,
      vehicle: "2018 Honda Accord",
      values,
    });
    await cmd({ type: "close_opportunity", id: op, outcome: "sold" });
    const resale = await one<Sale>(
      "select * from dmcrm_sales where opportunity_id=$1 and status='sold'",
      [op],
    );
    assert.notEqual(resale.id, sale.id);
    assert.equal(resale.snapshot.quote?.values.serviceContract, 1500);
    let newTrade = await one<TradeIntake>(
      "select * from dmcrm_trades where sale_id=$1",
      [resale.id],
    );
    await cmd({
      type: "update_trade_intake",
      id: newTrade.id,
      revision: 0,
      trade: editableTrade(newTrade),
    });
    newTrade = await row("trades", newTrade.id);
    assert.equal(
      newTrade.inventory_id,
      intake.inventory_id,
      "Reuse returned inventory without losing previous intake",
    );
    assert.equal(
      await count(
        "from dmcrm_tasks where opportunity_id=$1 and kind='sold_followup' and canceled_at is null and completed_at is null",
        [op],
      ),
      3,
    );
    // Do not unwind away a trade already promised on another deal.
    const linked = await cmd({
      type: "create_opportunity",
      customer_id: cid,
      opportunity: {
        title: "Trade resale",
        status: "working",
        source: "Walk-in",
        inventory_id: newTrade.inventory_id,
        vehicle_interest: "Ford F150",
        vehicle_details: null,
        trade_vehicle: "",
        trade: null,
      },
    });
    await assert.rejects(
      cmd({ type: "unwind_sale", opportunity_id: op, reason: "Wrong sale" }),
      /attached to another/,
    );
    assert.equal((await row("sales", resale.id)).status, "sold");
    assert.equal((await row("inventory", inventory)).status, "sold");
    await cmd({
      type: "close_opportunity",
      id: linked,
      outcome: "lost",
      reason: "Not proceeding",
    });
    await cmd({
      type: "update_trade_intake",
      id: newTrade.id,
      revision: 1,
      trade: {
        ...editableTrade(newTrade, "wholesaled"),
        wholesale_on: "2026-10-26",
        wholesale_price: 4300,
      },
    });
    await assert.rejects(
      cmd({ type: "unwind_sale", opportunity_id: op, reason: "Wrong sale" }),
      /sold wholesale/,
    );
    // Draft persistence never creates sends, and references are customer/tenant scoped.
    const mid = crypto.randomUUID(),
      draft = {
        type: "save_message",
        id: mid,
        revision: 0,
        customer_id: cid,
        opportunity_id: op,
        task_id: null,
        quote_id: resale.snapshot.quote!.id,
        channel: "email",
        recipient: "buyer@example.invalid",
        subject: "Your quote",
        body: "A prepared message",
      };
    await cmd(draft, actor);
    assert.equal((await row("messages", mid)).status, "draft");
    await cmd({ ...draft, body: "Updated draft" }, actor);
    await assert.rejects(cmd(draft, actor), /another session/);
    const cid2 = await cmd({
      type: "create_customer",
      customer: { ...customer, name: "Second Buyer" },
    });
    await assert.rejects(
      cmd({ ...draft, id: crypto.randomUUID(), customer_id: cid2 }),
      /Quote unavailable/,
    );
    await assert.rejects(
      cmd({
        ...draft,
        id: crypto.randomUUID(),
        customer_id: crypto.randomUUID(),
      }),
      /Customer unavailable/,
    );
    await cmd({ type: "delete_message_draft", id: mid, revision: 1 }, actor);
    assert.equal((await row("messages", mid)).status, "canceled");
    await assert.rejects(cmd({ ...draft, revision: 2 }), /unsent drafts/);
    assert.equal(
      await count(
        "from dmcrm_messages where status in('queued','sent','delivered')",
      ),
      0,
    );
    await pg.exec("set role authenticated");
    await assert.rejects(
      pg.query("select * from dmcrm_sales"),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});

test("profit calculations use actual costs and exclude tax, deposits and payoffs from gross", () => {
  const ws = demoWorkspace(),
    o = ws.opportunities[0],
    c = ws.customers[0];
  const q = {
    ...ws.quotes[0],
    values,
    vehicle_details: vehicle,
    trade_snapshot: trade,
  };
  const sale: Sale = {
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    opportunity_id: o.id,
    customer_id: c.id,
    sold_on: "2025-12-03",
    created_at: "2025-12-03T15:00:00Z",
    revision: 0,
    unwound_at: null,
    unwind_reason: "",
    status: "sold",
    snapshot: {
      customer: c,
      opportunity: { ...o, trade },
      quote: q,
      salesperson: null,
    },
    accounting: {
      ...emptyAccounting,
      finance_reserve: 250,
      accessory_cost: 100,
      pack: 400,
    },
  };
  const commissions = [
    { sale_id: sale.id, amount: 500, paid_amount: 200 },
  ] as Commission[];
  const m = saleMath(sale, commissions);
  assert.equal(m.front, 3499);
  assert.equal(m.back, 1150);
  assert.equal(m.gross, 4649);
  assert.equal(m.net, 4149);
  assert.equal(m.payableFront, 3099);
  assert.equal(m.commissionBalance, 300);
  assert.equal(
    saleMath({
      ...sale,
      snapshot: {
        ...sale.snapshot,
        quote: {
          ...q,
          values: { ...values, tax: 9999, payoff: 99999, downPayment: 99999 },
        },
      },
    }).gross,
    m.gross,
  );
  const undone = saleMath({ ...sale, status: "unwound" }, commissions);
  assert.equal(undone.earned, 0);
  assert.equal(undone.paid, 200);
  assert.equal(undone.commissionBalance, -200);
  const unknown = {
    ...sale,
    snapshot: {
      ...sale.snapshot,
      quote: {
        ...q,
        values: { ...values, products: [{ ...product, cost: null }] },
      },
    },
  };
  assert.equal(saleMath(unknown).gross, null);
  assert.equal(saleMath(unknown).complete, false);
  assert.equal(
    commandSchema.safeParse({
      type: "save_accounting",
      sale_id: sale.id,
      revision: 0,
      accounting: emptyAccounting,
      commissions: [
        {
          id: crypto.randomUUID(),
          staff_id: crypto.randomUUID(),
          category: "sales",
          amount: 50,
          paid_amount: 100,
          paid_on: "2026-10-26",
          notes: "",
        },
      ],
    }).success,
    false,
  );
});

test("search combines inclusive sold dates, frozen vehicles, name, status and exact/radius ZIP", () => {
  const ws = demoWorkspace();
  const target = ws.opportunities.find((o) => o.status === "sold")!,
    c = ws.customers.find((c) => c.id === target.customer_id)!;
  c.person = {
    ...blankPerson,
    first_name: "Taylor",
    last_name: "Brooks",
    zip: "28562",
  };
  target.sold_on = "2025-12-03";
  target.vehicle_details = { ...vehicle, vin: "1HGCM82633A004352" };
  target.sale_snapshot = {
    ...target.sale_snapshot!,
    customer: structuredClone(c),
    quote: { ...ws.quotes[0], vehicle_details: target.vehicle_details },
    insurance: null,
    salesperson: null,
  };
  const f: SearchFilters = {
    query: "Taylor",
    vehicle: "Accord DM104",
    status: "sold",
    from: "2025-11-12",
    to: "2025-12-03",
    zip: "",
    radius: 0,
    staff: "",
  };
  assert.equal(searchDeals(ws, f).length, 1);
  assert.equal(searchDeals(ws, { ...f, to: "2025-12-02" }).length, 0);
  target.sold_on = "2025-11-12";
  assert.equal(searchDeals(ws, f).length, 1);
  assert.equal(searchDeals(ws, { ...f, status: "active" }).length, 0);
  const points = {
    "28562": [35.08098, -77.12503],
    "28560": [35.15, -77.0],
    "90210": [34.1, -118.4],
  } as Record<string, [number, number]>;
  assert.equal(searchDeals(ws, { ...f, zip: "28562" }, points).length, 1);
  assert.equal(
    searchDeals(ws, { ...f, zip: "28560", radius: 25 }, points).length,
    1,
  );
  assert.equal(
    searchDeals(ws, { ...f, zip: "90210", radius: 25 }, points).length,
    0,
  );
  assert.equal(
    searchDeals(ws, { ...f, zip: "99999", radius: 25 }, points).length,
    0,
  );
  assert.equal(distanceMiles(points["28562"], points["28562"]), 0);
  assert.ok(csvText([['=HYPERLINK("bad")', -20]]).startsWith("\"'=HYPERLINK"));
});

test("demo sale and unwind retain real lifecycle behavior and draft status", () => {
  let ws = demoWorkspace(),
    o = ws.opportunities[0],
    c = ws.customers.find((c) => c.id === o.customer_id)!;
  o.trade = trade;
  o.trade_vehicle = trade.description;
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: c.id,
    opportunity_id: o.id,
    vehicle: o.vehicle_interest,
    values,
  });
  ws = demoCommand(ws, {
    type: "close_opportunity",
    id: o.id,
    outcome: "sold",
  });
  const sale = ws.sales!.find((s) => s.opportunity_id === o.id)!;
  assert.equal(sale.snapshot.quote?.values.serviceContract, 1500);
  ws = demoCommand(ws, {
    type: "unwind_sale",
    opportunity_id: o.id,
    reason: "Sample reversal",
  });
  assert.equal(ws.sales!.find((s) => s.id === sale.id)?.status, "unwound");
  assert.equal(ws.opportunities.find((x) => x.id === o.id)?.status, "working");
  assert.equal(
    ws.trades!.find((t) => t.sale_id === sale.id)?.status,
    "returned",
  );
  const id = crypto.randomUUID();
  ws = demoCommand(ws, {
    type: "save_message",
    id,
    revision: 0,
    customer_id: c.id,
    opportunity_id: o.id,
    task_id: null,
    quote_id: null,
    channel: "sms",
    recipient: "2525550101",
    subject: "",
    body: "Draft only",
  });
  assert.equal(ws.messages!.find((m) => m.id === id)?.status, "draft");
});

test("customer quote PDF includes all F&I prices and never exposes acquisition cost, ACV or commissions", async () => {
  const { customerQuoteLines, buildCustomerQuotePdf } =
    await import("../lib/quote-export");
  const { PDFDocument } = await import("pdf-lib");
  const ws = demoWorkspace(),
    c = ws.customers[0],
    q = {
      ...ws.quotes[0],
      values: {
        ...values,
        acv: 876543,
        products: [{ ...product, cost: 765432 }],
      },
      vehicle_details: { ...vehicle, cost: 654321 },
    };
  const lines = customerQuoteLines(q, c),
    text = JSON.stringify(lines);
  assert.ok(text.includes("Service contract"));
  assert.ok(text.includes("$1,500.00"));
  for (const hidden of [
    "876543",
    "876,543",
    "765432",
    "765,432",
    "654321",
    "654,321",
    "ACV",
    "commission",
    "cost",
  ])
    assert.equal(text.includes(hidden), false, hidden);
  const pdf = await PDFDocument.load(await buildCustomerQuotePdf(q, c));
  assert.equal(pdf.getPageCount(), 1);
  const sale: Sale = {
    id: q.id,
    org_id: ws.org.id,
    opportunity_id: ws.opportunities[0].id,
    customer_id: c.id,
    sold_on: "2025-12-03",
    created_at: q.created_at,
    status: "sold",
    revision: 0,
    unwound_at: null,
    unwind_reason: "",
    snapshot: {
      quote: q,
      customer: c,
      opportunity: ws.opportunities[0],
      salesperson: null,
    },
    accounting: { ...emptyAccounting, product_costs: { [product.id]: 400 } },
  };
  assert.equal(saleMath(sale).productCost, 400);
  assert.equal(
    q.values.products[0].cost,
    765432,
    "Original quote cost remains unchanged",
  );
});
