import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  quoteMath,
  defaultQuote,
  dayKey,
  demoCommand,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";

test("quote includes trade payoff and excludes internal appraisal values", () => {
  const v = {
    ...defaultQuote,
    price: 10000,
    docFee: 399,
    tax: 300,
    titleFee: 100,
    tradeAllowance: 2000,
    payoff: 1500,
    downPayment: 1000,
    apr: 0,
    months: 60,
    acv: 999999,
    recon: 999999,
  };
  const m = quoteMath(v);
  assert.deepEqual(
    { total: m.total, balance: m.balance, payment: m.payment },
    { total: 10299, balance: 9299, payment: 154.98 },
  );
  assert.equal(quoteMath({ ...v, apr: 12 }).payment, 206.85);
});
test("Eastern dealership dates and strict command validation", () => {
  assert.equal(dayKey("2026-10-26T02:00:00Z"), "2026-10-25");
  assert.equal(
    commandSchema.safeParse({
      type: "create_task",
      customer_id: null,
      title: "Call customer",
      due_date: "2026-02-30",
      kind: "task",
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "save_quote",
      customer_id: crypto.randomUUID(),
      vehicle: "Test",
      values: { ...defaultQuote, price: -1 },
    }).success,
    false,
  );
});
test("demo sold workflow cancels unsold tasks without checking out customer", () => {
  const now = new Date("2026-10-26T16:00:00Z");
  let s = demoWorkspace(now);
  const c = s.customers[0],
    o = s.opportunities.find((o) => o.customer_id === c.id)!;
  s = demoCommand(
    s,
    {
      type: "create_task",
      customer_id: c.id,
      opportunity_id: o.id,
      title: "Unsold",
      due_date: "2026-10-27",
      kind: "unsold_followup",
    },
    now,
  );
  s = demoCommand(
    s,
    { type: "close_opportunity", id: o.id, outcome: "sold" },
    now,
  );
  assert.equal(s.opportunities.find((x) => x.id === o.id)!.status, "sold");
  assert.equal(s.visits.find((v) => v.customer_id === c.id)?.departed_at, null);
  assert.equal(s.visits.find((v) => v.customer_id === c.id)?.outcome, "sold");
  assert.equal(
    s.tasks.filter((t) => t.customer_id === c.id && t.kind === "sold_followup")
      .length,
    3,
  );
  assert.ok(s.tasks.find((t) => t.title === "Unsold")?.canceled_at);
  const n = s.tasks.length;
  s = demoCommand(
    s,
    { type: "close_opportunity", id: o.id, outcome: "sold" },
    now,
  );
  assert.equal(s.tasks.length, n);
});

test("database isolates dealerships, denies browser roles, deduplicates visits and automates sale follow-up", async () => {
  const pg = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000099",
    stranger = "00000000-0000-4000-8000-000000000098",
    org = "d5a1c100-0000-4000-8000-000000000001",
    org2 = "00000000-0000-4000-8000-000000000097";
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}'),('${stranger}');insert into public.staff values('${owner}','Test owner',true,'owner');`,
    );
    const sql = await fs.readFile(
      new URL("../db/001_crm.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(sql);
    const cmd = async (p: unknown, orgId = org, actor = owner) => {
      const r = await pg.query<{ id: string }>(
        "select public.dmcrm_command($1,$2,$3::jsonb) as id",
        [orgId, actor, JSON.stringify(p)],
      );
      return r.rows[0].id;
    };
    const c = await cmd({
      type: "create_customer",
      customer: {
        name: "Test customer",
        email: "test@example.com",
        phone: "",
        source: "Walk-in",
        status: "new",
        vehicle_interest: "Honda",
        trade_vehicle: "Civic",
        birthday: "1990-02-28",
      },
    });
    await assert.rejects(
      cmd({ type: "check_in", customer_id: c }, org, stranger),
      /membership/,
    );
    await pg.exec(
      `insert into public.dmcrm_orgs(id,name,slug) values('${org2}','Other dealer','other');insert into public.dmcrm_members values('${org2}','${stranger}','Other owner','owner',true);`,
    );
    await assert.rejects(
      cmd(
        {
          type: "add_activity",
          customer_id: c,
          kind: "note",
          body: "Forbidden",
        },
        org2,
        stranger,
      ),
      /unavailable/,
    );
    await assert.rejects(
      pg.query(
        "insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values($1,$2,'note','bad','bad')",
        [org2, c],
      ),
      /foreign key/,
    );
    await cmd({ type: "check_in", customer_id: c });
    await cmd({ type: "check_in", customer_id: c });
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from public.dmcrm_visits",
        )
      ).rows[0].n,
      1,
    );
    await cmd({ type: "mark_sold", customer_id: c });
    await cmd({ type: "mark_sold", customer_id: c });
    const v = (
      await pg.query<{ id: string; departed_at: null; outcome: string }>(
        "select * from public.dmcrm_visits",
      )
    ).rows[0];
    assert.equal(v.departed_at, null);
    assert.equal(v.outcome, "sold");
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from public.dmcrm_tasks where kind='sold_followup'",
        )
      ).rows[0].n,
      3,
    );
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from public.dmcrm_tasks where kind='unsold_followup' and canceled_at is null",
        )
      ).rows[0].n,
      0,
    );
    await cmd({ type: "check_out", id: v.id });
    assert.equal(
      (
        await pg.query<{ outcome: string }>(
          "select outcome from public.dmcrm_visits",
        )
      ).rows[0].outcome,
      "sold",
    );
    const birthday = (
      await pg.query<{ id: string }>(
        "select id from public.dmcrm_tasks where kind='birthday'",
      )
    ).rows[0].id;
    await cmd({ type: "complete_task", id: birthday });
    await cmd({ type: "complete_task", id: birthday });
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from public.dmcrm_tasks where kind='birthday' and completed_at is null",
        )
      ).rows[0].n,
      1,
    );
    const annual = await pg.query<{ d: string }>(
      "select public.dmcrm_next_annual('2000-02-29'::date,'2027-02-01'::date)::text as d",
    );
    assert.equal(annual.rows[0].d, "2027-02-28");
    for (const role of ["anon", "authenticated"]) {
      await pg.exec("set role " + role);
      await assert.rejects(
        pg.query("select * from public.dmcrm_customers"),
        /permission denied/,
      );
      await assert.rejects(
        cmd({ type: "check_in", customer_id: c }),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
    assert.equal(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from public.staff",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await pg.close();
  }
});
