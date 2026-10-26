import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  defaultQuote,
  demoCommand,
  type Customer,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  inventorySchema,
  tradeSchema,
  parseVinDecode,
  daysOnHand,
  type InventoryInput,
} from "../lib/vehicles";
import { deskingDefaults } from "../lib/desking";
const car: InventoryInput = {
  vin: "1HGCM82633A004352",
  stock_number: "DM-101",
  year: 2003,
  make: "Honda",
  model: "Accord",
  trim: "EX",
  mileage: 121400,
  color: "Silver",
  cost: 3000,
  recon: 450,
  price: 5995,
  acquired_on: "2026-10-01",
  status: "in_stock",
};
const trade = {
  vin: "1FTFW1ET1EFA00001",
  mileage: 146200,
  allowance: 4000,
  acv: 3500,
  payoff: 1200,
  year: 2014,
  make: "Ford",
  model: "F-150",
  trim: "XLT",
  description: "2014 Ford F-150 XLT",
};
const contact = {
  name: "Inventory QA",
  email: "qa@example.invalid",
  phone: "",
  source: "Walk-in",
  status: "new" as const,
  vehicle_interest: "",
  trade_vehicle: "",
  birthday: null,
};

test("trade requires VIN and each financial field; zero payoff is valid; acquisition dates are real", () => {
  for (const key of ["vin", "mileage", "allowance", "acv", "payoff"]) {
    const bad = { ...trade } as Record<string, unknown>;
    delete bad[key];
    assert.equal(tradeSchema.safeParse(bad).success, false, key);
  }
  assert.equal(tradeSchema.safeParse({ ...trade, payoff: 0 }).success, true);
  assert.equal(
    tradeSchema.safeParse({ ...trade, vin: "BADVIN" }).success,
    false,
  );
  assert.equal(tradeSchema.safeParse({ ...trade, acv: -1 }).success, false);
  assert.equal(
    inventorySchema.safeParse({ ...car, acquired_on: "2026-02-30" }).success,
    false,
  );
  assert.equal(daysOnHand("2026-10-01", "2026-10-26"), 25);
});
test("VIN decode reports partial/flagged results and rejects empty provider responses", () => {
  assert.deepEqual(
    parseVinDecode(
      {
        Results: [
          {
            ModelYear: "2003",
            Make: "HONDA",
            Model: "Accord",
            Trim: "EX",
            ErrorCode: "0",
            BodyClass: "Sedan",
          },
        ],
      },
      car.vin,
    ),
    {
      vin: car.vin,
      year: 2003,
      make: "HONDA",
      model: "Accord",
      trim: "EX",
      body: "Sedan",
      warning: null,
    },
  );
  assert.ok(
    parseVinDecode(
      { Results: [{ ModelYear: "2003", Make: "HONDA", ErrorCode: "5,14" }] },
      car.vin,
    ).warning,
  );
  assert.throws(() => parseVinDecode({ Results: [] }, car.vin), /no vehicle/);
  assert.throws(
    () => parseVinDecode({ Results: [{ ErrorCode: "7" }] }, car.vin),
    /No vehicle/,
  );
});
test("desking seeds stock and trade values, preserves negotiated saved figures, updates changed trades", () => {
  const ws = demoWorkspace(new Date("2026-10-26T16:00:00Z")),
    v = ws.inventory[0],
    c: Customer = {
      ...ws.customers[0],
      inventory_id: v.id,
      vehicle_interest: "2003 Honda Accord EX",
      trade,
    };
  const first = deskingDefaults(c, ws.inventory);
  assert.equal(first.price, v.price);
  assert.equal(first.tradeAllowance, 4000);
  assert.equal(first.acv, 3500);
  assert.equal(first.payoff, 1200);
  const saved = {
    id: crypto.randomUUID(),
    org_id: c.org_id,
    customer_id: c.id,
    vehicle: c.vehicle_interest,
    inventory_id: v.id,
    values: { ...first, price: 5500, tradeAllowance: 4200 },
    created_at: "2026-10-26T16:00:00Z",
    trade_input: trade,
  };
  assert.equal(deskingDefaults(c, ws.inventory, saved).tradeAllowance, 4200);
  assert.equal(deskingDefaults(c, ws.inventory, saved).price, 5500);
  assert.equal(
    deskingDefaults(
      { ...c, trade: { ...trade, allowance: 4400 } },
      ws.inventory,
      saved,
    ).tradeAllowance,
    4400,
  );
  assert.equal(
    deskingDefaults(
      {
        ...c,
        inventory_id: null,
        vehicle_interest: "Manual truck",
        vehicle_details: { ...car, price: 8500 },
      },
      ws.inventory,
      saved,
    ).price,
    8500,
  );
});
test("ending a demo visit preserves unsold customer and visit; a sale marks linked stock sold", () => {
  let ws = demoWorkspace(new Date("2026-10-26T16:00:00Z"));
  const c = ws.customers[0],
    visit = ws.visits.find((v) => v.customer_id === c.id)!;
  ws = demoCommand(ws, { type: "check_out", id: visit.id });
  assert.ok(ws.visits.find((v) => v.id === visit.id)?.departed_at);
  assert.equal(ws.visits.find((v) => v.id === visit.id)?.outcome, "unsold");
  assert.notEqual(ws.customers[0].status, "sold");
  ws = demoCommand(ws, {
    type: "update_customer",
    id: c.id,
    customer: {
      ...contact,
      inventory_id: ws.inventory[0].id,
      trade,
      vehicle_details: null,
    },
  });
  ws = demoCommand(ws, { type: "mark_sold", customer_id: c.id });
  assert.equal(ws.inventory[0].status, "sold");
});
test("additive database upgrade preserves records, isolates inventory, snapshots proposals, and closes unsold visits", async () => {
  const pg = new PGlite(),
    owner = "00000000-0000-4000-8000-000000000099",
    stranger = "00000000-0000-4000-8000-000000000098",
    org = "d5a1c100-0000-4000-8000-000000000001",
    org2 = "00000000-0000-4000-8000-000000000097";
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}'),('${stranger}');insert into public.staff values('${owner}','Test owner',true,'owner');`,
    );
    await pg.exec(
      await fs.readFile(new URL("../db/001_crm.sql", import.meta.url), "utf8"),
    );
    const cmd = async (p: unknown, orgId = org, actor = owner) => {
      const r = await pg.query<{ id: string }>(
        "select public.dmcrm_command($1,$2,$3::jsonb) as id",
        [orgId, actor, JSON.stringify(p)],
      );
      return r.rows[0].id;
    };
    const cid = await cmd({
      type: "create_customer",
      customer: {
        ...contact,
        vehicle_interest: "Legacy Ford",
        trade_vehicle: "Legacy trade",
      },
    });
    const qold = await cmd({
      type: "save_quote",
      customer_id: cid,
      vehicle: "Legacy Ford",
      values: defaultQuote,
    });
    await pg.exec(
      await fs.readFile(
        new URL("../db/002_inventory_desking.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      (
        await pg.query<{ vehicle_interest: string }>(
          "select vehicle_interest from public.dmcrm_customers where id=$1",
          [cid],
        )
      ).rows[0].vehicle_interest,
      "Legacy Ford",
    );
    assert.equal(
      (
        await pg.query<{ vehicle: string }>(
          "select vehicle from public.dmcrm_quotes where id=$1",
          [qold],
        )
      ).rows[0].vehicle,
      "Legacy Ford",
    );
    const vid = await cmd({ type: "save_inventory", vehicle: car });
    await assert.rejects(
      cmd({ type: "save_inventory", vehicle: car }),
      /unique/,
    );
    await pg.exec(
      `insert into public.dmcrm_orgs(id,name,slug) values('${org2}','Other dealer','other');insert into public.dmcrm_members values('${org2}','${stranger}','Other owner','owner',true);`,
    );
    await assert.rejects(
      cmd({ type: "save_inventory", id: vid, vehicle: car }, org2, stranger),
      /unavailable/,
    );
    await assert.rejects(
      cmd(
        {
          type: "create_customer",
          customer: { ...contact, inventory_id: vid },
        },
        org2,
        stranger,
      ),
      /unavailable/,
    );
    await cmd(
      commandSchema.parse({
        type: "update_customer",
        id: cid,
        customer: {
          ...contact,
          inventory_id: vid,
          vehicle_details: { ...car, price: 1 },
          trade,
        },
      }),
    );
    const c = (
      await pg.query<{
        vehicle_interest: string;
        vehicle_details: { price: number };
        trade: { acv: number };
      }>("select * from public.dmcrm_customers where id=$1", [cid])
    ).rows[0];
    assert.equal(c.vehicle_interest, "2003 Honda Accord EX");
    assert.equal(c.vehicle_details.price, 5995);
    assert.equal(c.trade.acv, 3500);
    const qid = await cmd({
      type: "save_quote",
      customer_id: cid,
      vehicle: c.vehicle_interest,
      values: {
        ...defaultQuote,
        price: 5500,
        tradeAllowance: 4200,
        acv: 3500,
        payoff: 1200,
      },
    });
    await cmd({
      type: "save_inventory",
      id: vid,
      vehicle: { ...car, price: 6495, cost: 3200 },
    });
    const quote = (
      await pg.query<{
        vehicle_details: { price: number; cost: number };
        trade_snapshot: { allowance: number };
        trade_input: { allowance: number };
      }>("select * from public.dmcrm_quotes where id=$1", [qid])
    ).rows[0];
    assert.equal(quote.vehicle_details.price, 5995);
    assert.equal(quote.vehicle_details.cost, 3000);
    assert.equal(quote.trade_snapshot.allowance, 4200);
    assert.equal(quote.trade_input.allowance, 4000);
    const visit = await cmd({ type: "check_in", customer_id: cid });
    await cmd({ type: "check_out", id: visit });
    await cmd({ type: "check_out", id: visit });
    const ended = (
      await pg.query<{ outcome: string; departed_at: string }>(
        "select * from public.dmcrm_visits where id=$1",
        [visit],
      )
    ).rows[0];
    assert.equal(ended.outcome, "unsold");
    assert.ok(ended.departed_at);
    assert.equal(
      (
        await pg.query<{ status: string }>(
          "select status from public.dmcrm_customers where id=$1",
          [cid],
        )
      ).rows[0].status,
      "new",
    );
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from public.dmcrm_tasks where origin_key=$1",
          ["visit:" + visit],
        )
      ).rows[0].n,
      1,
    );
    await cmd({ type: "mark_sold", customer_id: cid });
    assert.equal(
      (
        await pg.query<{ status: string }>(
          "select status from public.dmcrm_inventory where id=$1",
          [vid],
        )
      ).rows[0].status,
      "sold",
    );
    await assert.rejects(
      cmd({
        type: "create_customer",
        customer: { ...contact, inventory_id: vid },
      }),
      /in-stock/,
    );
    for (const role of ["anon", "authenticated"]) {
      await pg.exec("set role " + role);
      await assert.rejects(
        pg.query("select * from public.dmcrm_inventory"),
        /permission denied/,
      );
      await assert.rejects(
        cmd({ type: "save_inventory", vehicle: car }),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    await assert.rejects(
      pg.query("select public.dmcrm_command_v1($1,$2,$3::jsonb)", [
        org,
        owner,
        "{}",
      ]),
      /permission denied/,
    );
    await pg.exec("reset role");
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from public.staff",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await pg.close();
  }
});
