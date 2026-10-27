import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  appraisalDataSchema,
  appraisalEntries,
  appraisalMath,
  comparableSummary,
  driveMaxComparables,
  newAppraisalData,
  safeResearchUrl,
  type Comparable,
} from "../lib/appraisals";
import { customerOpportunityBadges } from "../lib/customer-status";
import { parseMarketListings } from "../lib/appraisal-market";
import { demoWorkspace } from "../lib/demo";
import { commandSchema, demoCommand, type Opportunity } from "../lib/model";
import { verifyAppraisals } from "../scripts/verify-appraisals.mjs";

const vehicle = {
  vin: "2FMPK3K94KBC11561",
  year: 2019,
  make: "Ford",
  model: "Edge",
  trim: "Titanium",
  mileage: 132558,
};
const data = () => ({
  ...newAppraisalData(),
  vehicle,
  target_value: 11000,
  target_profit: 2000,
  proposed_acv: 6200,
  recon: [{ id: randomUUID(), label: "Tires", amount: 800.25 }],
  buyer_fee: 100,
  transport: 150,
  other_cost: 50.5,
});
const comp = (
  price: number,
  basis: Comparable["basis"] = "retail_asking",
  included = true,
): Comparable => ({
  id: randomUUID(),
  vehicle: "2019 Ford Edge",
  vin: "",
  mileage: 130000,
  price,
  basis,
  source: "Test listing",
  date: "2026-10-27",
  url: "",
  notes: "",
  included,
});
test("appraisal arithmetic preserves cents, unknown prices and negative buying limits", () => {
  assert.deepEqual(appraisalMath(data()), {
    recon: 800.25,
    expenses: 1100.75,
    maxBuy: 7899.25,
    invested: 7300.75,
    projectedProfit: 3699.25,
  });
  assert.equal(appraisalMath({ ...data(), target_value: null }).maxBuy, null);
  assert.equal(
    appraisalMath({ ...data(), proposed_acv: null }).projectedProfit,
    null,
  );
  assert.equal(
    appraisalMath({ ...data(), target_value: 1000 }).maxBuy,
    -2100.75,
  );
  assert.equal(
    appraisalMath({ ...data(), proposed_acv: 0 }).projectedProfit,
    9899.25,
  );
});
test("comparable ranges never mix asking, private, sold or excluded prices", () => {
  const rows = [
    comp(9000),
    comp(11000),
    comp(10, "sold"),
    comp(4000, "private_asking"),
    comp(50000, "retail_asking", false),
    comp(0),
  ];
  assert.deepEqual(comparableSummary(rows), {
    count: 2,
    low: 9000,
    high: 11000,
    median: 10000,
  });
  assert.equal(comparableSummary(rows, "sold")?.median, 10);
  assert.equal(comparableSummary([], "wholesale"), null);
});
test("appraisal inputs reject bad money, book ranges and unsafe or credential-bearing URLs", () => {
  assert(appraisalDataSchema.safeParse(data()).success);
  for (const patch of [
    { target_profit: -1 },
    { zip: "ABC" },
    { vehicle: { ...vehicle, year: 0 } },
    { comparables: [comp(0)] },
    { target_value: Infinity },
  ])
    assert(!appraisalDataSchema.safeParse({ ...data(), ...patch }).success);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "https://u:p@example.com",
    "https://example.com/?api_key=secret",
  ])
    assert.equal(safeResearchUrl(url), "");
  assert.equal(
    safeResearchUrl("https://www.kbb.com/car-values/"),
    "https://www.kbb.com/car-values/",
  );
  assert(
    !appraisalDataSchema.safeParse({
      ...data(),
      books: [
        {
          id: randomUUID(),
          source: "KBB",
          basis: "trade",
          low: 9000,
          high: 5000,
          date: "2026-10-27",
          condition: "Good",
          url: "",
        },
      ],
    }).success,
  );
});
test("market adapter uses actual priced listings, safe URLs, timestamps and VIN deduplication", () => {
  const rows = parseMarketListings(
    {
      listings: [
        {
          heading: "2019 Ford Edge",
          vin: vehicle.vin,
          price: 10000,
          miles: 120000,
          vdp_url: "https://dealer.example/car",
          source: "dealer.example",
          last_seen_at_date: "2026-10-26T12:00:00Z",
        },
        { heading: "Duplicate", vin: vehicle.vin, price: 9000 },
        { heading: "Call for price" },
        { heading: "Zero price", price: 0 },
        {
          heading: "Other",
          price: 11000,
          vdp_url: "https://example.com/?api_key=private",
        },
      ],
    },
    "2026-10-27",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].basis, "retail_asking");
  assert.equal(rows[0].date, "2026-10-27");
  assert.match(rows[0].notes, /2026-10-26/);
  assert.equal(rows[1].url, "");
  assert(!JSON.stringify(rows).includes("private"));
});
test("all opportunity trades surface once and customer badges preserve mixed active and sold history", () => {
  const ws = demoWorkspace();
  ws.appraisals = [];
  const c = ws.customers[0],
    base = ws.opportunities[0];
  ws.opportunities = [
    {
      ...base,
      id: randomUUID(),
      customer_id: c.id,
      trade: {
        ...vehicle,
        acv: 6500,
        allowance: 5000,
        payoff: 0,
        description: "Trade",
      },
      trade_vehicle: "2019 Ford Edge",
      status: "working",
    },
    {
      ...base,
      id: randomUUID(),
      customer_id: c.id,
      trade: null,
      trade_vehicle: "Legacy trade",
      status: "sold",
    },
  ];
  const entries = appraisalEntries(ws);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].history, false);
  assert.equal(entries[1].history, true);
  const badges = customerOpportunityBadges(ws.opportunities, c.id);
  assert.equal(badges.tone, "working");
  assert.deepEqual(
    badges.badges.map((b) => b.status),
    ["working", "sold"],
  );
});
test("Drive Max history excludes unwound deals and preserves actual selling prices distinct from inventory asking prices", () => {
  const ws = demoWorkspace(),
    q = ws.quotes[0],
    car = { ...ws.inventory[0], ...vehicle };
  ws.inventory = [
    {
      ...car,
      id: randomUUID(),
      vin: "1HGCM82633A004352",
      status: "in_stock",
      price: 12000,
    },
  ];
  const sale = {
    id: randomUUID(),
    status: "sold",
    sold_on: "2026-10-20",
    snapshot: {
      quote: {
        ...q,
        vehicle_details: car,
        values: { ...q.values, price: 10500 },
      },
      opportunity: { vehicle_details: car },
    },
  };
  ws.sales = [sale, { ...sale, id: randomUUID(), status: "unwound" }] as any;
  const rows = driveMaxComparables(ws, vehicle);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.basis === "sold")?.price, 10500);
  assert.equal(rows.find((r) => r.basis === "retail_asking")?.price, 12000);
});
test("real SQL appraisal lifecycle: revisions, permissions, closed deals, ACV isolation and audit", async (t) => {
  const pg = new PGlite(),
    org = "d5a1c100-0000-4000-8000-000000000001",
    owner = "00000000-0000-4000-8000-000000000099",
    sales = "00000000-0000-4000-8000-000000000098",
    outsider = "00000000-0000-4000-8000-000000000097";
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const command = async (p: unknown, actor = owner, organization = org) =>
    one("select dmcrm_command($1,$2,$3::jsonb) id", [
      organization,
      actor,
      JSON.stringify(p),
    ]);
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const f of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(
      `insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${outsider}','other@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Test Owner','owner');`,
    );
    for (const f of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await pg.exec("begin");
    await verifyAppraisals(pg);
    await pg.exec("commit");
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales User','sales'),('${org}','${outsider}','Other User','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales User','sales@example.invalid','sales'),('${org}','${outsider}','Other User','other@example.invalid','sales');`,
    );
    const staff = (
        await one("select id from dmcrm_staff where user_id=$1", [sales])
      ).id,
      cid = randomUUID(),
      oid = randomUUID(),
      aid = randomUUID();
    await pg.query(
      "insert into dmcrm_customers(id,org_id,name) values($1,$2,'Test customer')",
      [cid, org],
    );
    await pg.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,trade,trade_vehicle) values($1,$2,$3,$4,$5::jsonb,'2019 Ford Edge')",
      [
        oid,
        org,
        cid,
        staff,
        JSON.stringify({
          ...vehicle,
          acv: 6500,
          allowance: 5000,
          payoff: 0,
          description: "Trade",
        }),
      ],
    );
    const save = {
      type: "save_appraisal",
      id: aid,
      revision: 0,
      opportunity_id: oid,
      source: "trade",
      status: "review",
      data: data(),
    };
    await t.test(
      "assigned salesperson can research; unrelated sales and cross-tenant requests cannot",
      async () => {
        await assert.rejects(command(save, outsider), /assigned salesperson/);
        await assert.rejects(
          command(save, sales, randomUUID()),
          /Active team membership/,
        );
        await command(commandSchema.parse(save), sales);
        await assert.rejects(
          command({ ...save, id: randomUUID() }, sales),
          /already has an appraisal/,
        );
        await assert.rejects(
          command({ type: "approve_appraisal", id: aid, revision: 1 }, sales),
          /Manager access/,
        );
      },
    );
    await t.test(
      "stale revisions and invalid financial values are rejected by database",
      async () => {
        await assert.rejects(command(save), /changed in another session/);
        await assert.rejects(
          command({
            ...save,
            revision: 1,
            data: { ...data(), proposed_acv: -1 },
          }),
          /Check the appraisal/,
        );
        await command({ type: "approve_appraisal", id: aid, revision: 1 });
      },
    );
    await t.test(
      "changed trade and stale opportunity prevent approved ACV application",
      async () => {
        await pg.query(
          "update dmcrm_opportunities set trade=jsonb_set(trade,'{mileage}','150000'),updated_at=now() where id=$1",
          [oid],
        );
        await assert.rejects(
          command({
            type: "apply_appraisal",
            id: aid,
            revision: 2,
            opportunity_updated_at: new Date().toISOString(),
          }),
          /Trade details changed/,
        );
        await pg.query(
          "update dmcrm_opportunities set trade=jsonb_set(trade,'{mileage}','132558') where id=$1",
          [oid],
        );
        await assert.rejects(
          command({
            type: "apply_appraisal",
            id: aid,
            revision: 2,
            opportunity_updated_at: "2000-01-01T00:00:00Z",
          }),
          /Opportunity changed/,
        );
      },
    );
    await t.test(
      "saving edits invalidates approval and does not silently change trade financials",
      async () => {
        await command({
          ...save,
          revision: 2,
          status: "draft",
          data: { ...data(), proposed_acv: 6100 },
        });
        assert.equal(
          (
            await one("select trade from dmcrm_opportunities where id=$1", [
              oid,
            ])
          ).trade.acv,
          6500,
        );
        assert.equal(
          (
            await one("select reviewed_at from dmcrm_appraisals where id=$1", [
              aid,
            ])
          ).reviewed_at,
          null,
        );
        await assert.rejects(
          command({
            type: "apply_appraisal",
            id: aid,
            revision: 3,
            opportunity_updated_at: new Date().toISOString(),
          }),
          /Approve a linked/,
        );
      },
    );
    await t.test(
      "closed deals are read-only and cannot be approved or edited",
      async () => {
        await pg.query(
          "update dmcrm_opportunities set status='lost',closed_at=now() where id=$1",
          [oid],
        );
        await assert.rejects(command({ ...save, revision: 3 }), /Closed deal/);
        await assert.rejects(
          command({ type: "approve_appraisal", id: aid, revision: 3 }),
          /Closed deal/,
        );
      },
    );
    await t.test(
      "standalone street and auction valuations persist, archive and restore",
      async () => {
        for (const source of ["street", "auction"]) {
          const id = randomUUID(),
            p = { ...save, id, opportunity_id: null, source };
          await command(p, sales);
          await assert.rejects(
            command({ ...p, revision: 1 }, outsider),
            /assigned salesperson/,
          );
          await command({ type: "archive_appraisal", id, revision: 1 }, sales);
          assert.equal(
            (await one("select status from dmcrm_appraisals where id=$1", [id]))
              .status,
            "archived",
          );
          await command({ ...p, revision: 2 }, sales);
          assert.equal(
            (
              await one("select revision from dmcrm_appraisals where id=$1", [
                id,
              ])
            ).revision,
            3,
          );
          await assert.rejects(
            command({ ...p, revision: 3, source: "trade" }),
            /source cannot/,
          );
        }
      },
    );
    await t.test(
      "appraisal tables have RLS and direct public command versions are revoked",
      async () => {
        assert.equal(
          (
            await one(
              "select relrowsecurity from pg_class where relname='dmcrm_appraisals'",
            )
          ).relrowsecurity,
          true,
        );
        assert.equal(
          (
            await one(
              "select has_function_privilege('authenticated','dmcrm_command(uuid,uuid,jsonb)','EXECUTE') ok",
            )
          ).ok,
          false,
        );
        assert.equal(
          (
            await one(
              "select has_function_privilege('service_role','dmcrm_command_v18(uuid,uuid,jsonb)','EXECUTE') ok",
            )
          ).ok,
          false,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
