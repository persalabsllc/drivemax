import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { defaultQuote, quoteSchema, demoCommand, dayKey } from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import { deskingDraft, deskingPaymentOptions } from "../lib/desking";
import { calculateQuote } from "../lib/finance";
import { customerQuoteLines } from "../lib/quote-export";
import {
  quoteMessage,
  searchCustomers,
  searchDeals,
  type Message,
} from "../lib/operations";
import { customerActivity } from "../lib/activity";
import { demoAttention } from "../lib/attention";
import { PriceQuotePrint } from "../components/PriceQuotePrint";

const org = "d5a1c100-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000099";
const sales = "00000000-0000-4000-8000-000000000098";
const otherOrg = "00000000-0000-4000-8000-000000000097";

test("new quotes use 25% and $114; saved quotes keep their figures, and presentation never changes the math", () => {
  assert.equal(defaultQuote.apr, 25);
  assert.equal(defaultQuote.titleFee, 114);
  assert.deepEqual(
    deskingPaymentOptions(defaultQuote).terms.map((t) => t.apr),
    [25, 25, 25],
  );
  const saved = { ...defaultQuote, apr: 9.99, titleFee: 55, showAPR: false };
  assert.equal(deskingDraft(saved, true).apr, 9.99);
  assert.equal(deskingDraft(saved, true).titleFee, 55);
  assert.equal(deskingDraft(saved, true).showAPR, false);
  assert.ok(
    quoteSchema.safeParse({ ...defaultQuote, daysToFirstPayment: 365 }).success,
  );
  assert.equal(
    quoteSchema.safeParse({ ...defaultQuote, daysToFirstPayment: 366 }).success,
    false,
  );
  const ws = demoWorkspace(),
    c = ws.customers[0];
  const q = {
    ...ws.quotes[0],
    values: {
      ...defaultQuote,
      price: 20000,
      serviceContract: 1800,
      daysToFirstPayment: 365,
      showAPR: false,
      showProtectionProducts: false,
    },
  };
  assert.deepEqual(
    calculateQuote(q.values),
    calculateQuote({
      ...q.values,
      showAPR: true,
      showProtectionProducts: true,
    }),
  );
  const lines = customerQuoteLines(q, c);
  assert.ok(!JSON.stringify(lines).includes("APR"));
  assert.ok(!JSON.stringify(lines).includes("Protection products"));
  assert.ok(!quoteMessage(q, c).includes("APR"));
  const hidden = renderToStaticMarkup(
    createElement(PriceQuotePrint, {
      customer: c,
      quote: q,
      dealership: "Drive Max",
    }),
  );
  assert.ok(!hidden.includes("APR"));
  assert.ok(!hidden.includes("first-period interest"));
  assert.ok(!hidden.includes("initial-period interest"));
  assert.ok(hidden.includes("365"));
  assert.ok(hidden.includes("Totals include selected optional coverage"));
  const shown = renderToStaticMarkup(
    createElement(PriceQuotePrint, {
      customer: c,
      dealership: "Drive Max",
      quote: {
        ...q,
        values: { ...q.values, showAPR: true, showProtectionProducts: true },
      },
    }),
  );
  assert.ok(shown.includes("25% APR"));
  assert.ok(shown.includes("Protection products"));
});

test("customer results deduplicate after precise deal/date/vehicle filtering and before pagination", () => {
  const ws = demoWorkspace(),
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  ws.customers = [c];
  ws.opportunities = [
    {
      ...o,
      id: crypto.randomUUID(),
      status: "sold",
      sold_on: "2025-11-12",
      vehicle_interest: "Honda Accord",
    },
    {
      ...o,
      id: crypto.randomUUID(),
      status: "sold",
      sold_on: "2025-12-03",
      vehicle_interest: "Toyota Camry",
    },
    {
      ...o,
      id: crypto.randomUUID(),
      status: "sold",
      sold_on: "2025-12-04",
      vehicle_interest: "Toyota Camry",
    },
  ];
  const filters = {
    query: c.name,
    vehicle: "",
    status: "sold",
    from: "2025-11-12",
    to: "2025-12-03",
    zip: "",
    radius: 0,
    staff: "",
  };
  assert.equal(searchDeals(ws, filters).length, 2);
  assert.equal(searchCustomers(ws, filters).length, 1);
  assert.equal(searchCustomers(ws, { ...filters, vehicle: "Honda" }).length, 1);
  assert.equal(
    searchCustomers(ws, {
      ...filters,
      from: "2025-12-04",
      to: "2025-12-04",
      vehicle: "Honda",
    }).length,
    0,
  );
});

test("all activity combines general and opportunity messages with calls and quotes, without claiming drafts were sent", () => {
  const ws = demoWorkspace(),
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  const m: Message = {
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    customer_id: c.id,
    opportunity_id: null,
    task_id: null,
    channel: "sms",
    direction: "inbound",
    status: "received",
    recipient: c.phone,
    subject: "",
    body: "Can I stop by today?",
    created_at: "2026-10-25T18:00:00Z",
    updated_at: "2026-10-25T18:00:00Z",
    created_by: ws.member.id,
    quote_id: null,
    revision: 0,
  };
  ws.messages = [
    m,
    {
      ...m,
      id: crypto.randomUUID(),
      opportunity_id: o.id,
      channel: "email",
      direction: "outbound",
      status: "draft",
      subject: "Draft quote",
      created_at: "2026-10-25T19:00:00Z",
    },
  ];
  const entries = customerActivity(ws, c.id);
  assert.ok(
    entries.some(
      (a) => a.label === "Text · Received" && a.context === "Customer profile",
    ),
  );
  assert.ok(
    entries.some(
      (a) => a.label === "Email · Draft · not sent" && a.context === o.title,
    ),
  );
  assert.ok(entries.some((a) => a.label === "Desking version saved"));
  assert.equal(new Set(entries.map((a) => a.id)).size, entries.length);
  for (let i = 1; i < entries.length; i++)
    assert.ok(entries[i - 1].created_at >= entries[i].created_at);
  const before = demoAttention(ws);
  assert.ok(before.items.some((i) => i.id === m.id));
  const reviewed = demoCommand(ws, {
    type: "review_attention",
    kind: "reply",
    id: m.id,
  });
  assert.ok(!demoAttention(reviewed).items.some((i) => i.id === m.id));
  assert.ok(
    demoAttention({
      ...reviewed,
      member: { ...reviewed.member, id: crypto.randomUUID() },
    }).items.some((i) => i.id === m.id),
  );
});

test("live migrations enforce safe deletion, preserved history, per-user alerts and complete task events", async () => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (p: unknown, actor = owner, oid = org): Promise<string> =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        oid,
        actor,
        JSON.stringify(p),
      ])
    ).id;
  const feed = async (actor = owner, oid = org) =>
    (await one("select dmcrm_attention($1,$2) feed", [oid, actor])).feed;
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
      create table public.staff(id uuid,name text,active boolean,role text);
      insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid');
      insert into public.staff values('${owner}','Test Owner',true,'owner');`);
    for (const name of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 11)
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + name, import.meta.url), "utf8"),
      );
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Sales User','sales')",
      [org, sales],
    );
    await pg.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Sales User','sales@example.invalid','sales')",
      [org, sales],
    );
    const own = await one("select * from dmcrm_staff where user_id=$1", [
      owner,
    ]);
    const rep = await one("select * from dmcrm_staff where user_id=$1", [
      sales,
    ]);
    const buyer = {
      name: "Workflow Buyer",
      phone: "2525550101",
      email: "buyer@example.invalid",
      source: "Phone",
      status: "new",
      vehicle_interest: "Sample car",
      trade_vehicle: "",
      birthday: null,
      assigned_to: own.id,
    };
    const cid = await cmd({ type: "create_customer", customer: buyer });
    const op = await one(
      "select * from dmcrm_opportunities where customer_id=$1",
      [cid],
    );
    assert.ok((await feed()).items.some((i: any) => i.key === `lead:${cid}`));
    assert.ok(
      !(await feed(sales)).items.some((i: any) => i.key === `lead:${cid}`),
    );
    await assert.rejects(
      cmd({ type: "review_attention", kind: "lead", id: cid }, sales),
      /no longer available/,
    );
    await assert.rejects(feed(owner, otherOrg), /membership required/);
    const inbound = crypto.randomUUID();
    const draft = crypto.randomUUID();
    const failed = crypto.randomUUID();
    for (const [id, direction, status] of [
      [inbound, "inbound", "received"],
      [draft, "outbound", "draft"],
      [failed, "outbound", "failed"],
    ]) {
      await pg.query(
        "insert into dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,body,created_by) values($1,$2,$3,$4,'sms',$5,$6,'2525550101','Test communication',$7)",
        [id, org, cid, op.id, direction, status, owner],
      );
    }
    assert.ok(
      (await feed()).items.some((i: any) => i.key === `reply:${inbound}`),
    );
    assert.ok(
      (await feed()).items.some((i: any) => i.key === `failed:${failed}`),
    );
    assert.ok(!(await feed()).items.some((i: any) => i.id === draft));
    await cmd({ type: "review_attention", kind: "reply", id: inbound });
    await cmd({ type: "review_attention", kind: "reply", id: inbound });
    assert.equal(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_attention_reads where alert_key=$1",
            [`reply:${inbound}`],
          )
        ).n,
      ),
      1,
    );
    assert.ok(!(await feed()).items.some((i: any) => i.id === inbound));
    await pg.query(
      "update dmcrm_opportunities set assigned_to=$1 where id=$2",
      [rep.id, op.id],
    );
    assert.ok((await feed(sales)).items.some((i: any) => i.id === inbound));
    const tid = await cmd({
      type: "create_task",
      customer_id: cid,
      opportunity_id: op.id,
      title: "Call about delivery",
      due_date: dayKey(),
      kind: "task",
      channel: "call",
      assigned_to: rep.id,
    });
    assert.ok((await feed(sales)).items.some((i: any) => i.id === tid));
    await cmd({ type: "complete_task", id: tid }, sales);
    await cmd({ type: "complete_task", id: tid }, sales);
    assert.ok(!(await feed(sales)).items.some((i: any) => i.id === tid));
    const events = (
      await pg.query<any>(
        "select body from dmcrm_activities where customer_id=$1",
        [cid],
      )
    ).rows.map((r: any) => r.body);
    assert.ok(
      events.some((b: string) =>
        b.startsWith("Task scheduled: Call about delivery"),
      ),
    );
    assert.equal(
      events.filter((b: string) => b === "Task completed: Call about delivery")
        .length,
      1,
    );
    const vehicle = {
      vin: "1HGCM82633A004352",
      stock_number: "TEST100",
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: "EX",
      mileage: 130000,
      color: "Silver",
      cost: 3000,
      recon: 400,
      price: 6500,
      acquired_on: "2026-10-01",
      status: "in_stock",
    };
    const vid = await cmd({ type: "save_inventory", vehicle });
    let iv = await one("select * from dmcrm_inventory where id=$1", [vid]);
    const del = {
      type: "delete_inventory",
      id: vid,
      updated_at: iv.updated_at,
      reason: "Duplicate entry",
    };
    await assert.rejects(cmd(del, sales), /Manager access/);
    await assert.rejects(cmd(del, owner, otherOrg), /membership/);
    await assert.rejects(
      cmd({ ...del, updated_at: "2020-01-01T00:00:00Z" }),
      /changed in another session/,
    );
    await pg.query(
      "update dmcrm_opportunities set inventory_id=$1 where id=$2",
      [vid, op.id],
    );
    await assert.rejects(cmd(del), /active or sold deal/);
    await pg.query("update dmcrm_opportunities set status='lost' where id=$1", [
      op.id,
    ]);
    await cmd(del);
    iv = await one("select * from dmcrm_inventory where id=$1", [vid]);
    assert.ok(iv.deleted_at);
    assert.equal(iv.status, "archived");
    assert.equal(iv.deletion_reason, "Duplicate entry");
    await assert.rejects(
      cmd({ type: "save_inventory", id: vid, vehicle }),
      /was deleted/,
    );
    await assert.rejects(
      pg.query("update dmcrm_opportunities set status='working' where id=$1", [
        op.id,
      ]),
      /was deleted/,
    );
    assert.ok(
      (
        await one(
          "select body from dmcrm_activities where opportunity_id=$1 and body like 'Inventory vehicle%deleted%'",
          [op.id],
        )
      ).body.includes("Duplicate entry"),
    );
    const replacement = await cmd({ type: "save_inventory", vehicle });
    assert.notEqual(replacement, vid);
    // A source sale retains all original financial values when its intake is removed.
    const sid = crypto.randomUUID(),
      tradeId = crypto.randomUUID();
    await pg.query(
      "insert into dmcrm_sales(id,org_id,opportunity_id,customer_id,sold_on,snapshot) values($1,$2,$3,$4,'2026-10-26',$5)",
      [
        sid,
        org,
        op.id,
        cid,
        { originalTradeAcv: 2500, originalTradeAllowance: 3000 },
      ],
    );
    await pg.query(
      "insert into dmcrm_trades(id,org_id,sale_id,opportunity_id,customer_id,stock_number,vin,mileage,cost,acquired_on,allowance,acv,payoff,inventory_id,status) values($1,$2,$3,$4,$5,'TEST100A','1HGCM82633A004352',130000,2500,'2026-10-26',3000,2500,700,$6,'retail')",
      [tradeId, org, sid, op.id, cid, replacement],
    );
    iv = await one("select * from dmcrm_inventory where id=$1", [replacement]);
    await assert.rejects(
      cmd({ ...del, id: replacement, updated_at: iv.updated_at }),
      /Trade-ins/,
    );
    await assert.rejects(
      cmd(
        {
          type: "delete_trade_intake",
          id: tradeId,
          revision: 0,
          reason: "Entered by mistake",
        },
        sales,
      ),
      /Manager access/,
    );
    await assert.rejects(
      cmd({
        type: "delete_trade_intake",
        id: tradeId,
        revision: 3,
        reason: "Entered by mistake",
      }),
      /changed in another session/,
    );
    await cmd({
      type: "delete_trade_intake",
      id: tradeId,
      revision: 0,
      reason: "Entered by mistake",
    });
    assert.ok(
      (await one("select deleted_at from dmcrm_trades where id=$1", [tradeId]))
        .deleted_at,
    );
    assert.ok(
      (
        await one("select deleted_at from dmcrm_inventory where id=$1", [
          replacement,
        ])
      ).deleted_at,
    );
    assert.deepEqual(
      (await one("select snapshot from dmcrm_sales where id=$1", [sid]))
        .snapshot,
      { originalTradeAcv: 2500, originalTradeAllowance: 3000 },
    );
    await assert.rejects(
      cmd({ type: "update_trade_intake", id: tradeId, revision: 1, trade: {} }),
      /was deleted/,
    );
    assert.ok(
      (
        await one(
          "select body from dmcrm_activities where opportunity_id=$1 and body like 'Trade-in%deleted%'",
          [op.id],
        )
      ).body.includes("Original sale and trade accounting retained"),
    );
    // Exercise a real sold -> removed retail trade -> unwind -> resale cycle.
    const saleVehicle = await cmd({
      type: "save_inventory",
      vehicle: { ...vehicle, vin: "1HGCM82633A004353", stock_number: "CYCLE" },
    });
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
    const cycle = await cmd({
      type: "create_opportunity",
      customer_id: cid,
      opportunity: {
        title: "Real cycle",
        status: "working",
        source: "Phone",
        inventory_id: saleVehicle,
        vehicle_interest: "Honda Accord",
        vehicle_details: null,
        trade_vehicle: trade.description,
        trade,
      },
    });
    const qid = await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: cycle,
      vehicle: "Honda Accord",
      values: {
        ...defaultQuote,
        price: 6500,
        tradeAllowance: 4000,
        acv: 3500,
        payoff: 2000,
        daysToFirstPayment: 365,
        showAPR: false,
        showProtectionProducts: false,
      },
    });
    assert.equal(
      (await one("select values from dmcrm_quotes where id=$1", [qid])).values
        .daysToFirstPayment,
      365,
    );
    await cmd({ type: "close_opportunity", id: cycle, outcome: "sold" });
    let intake = await one(
      "select * from dmcrm_trades where opportunity_id=$1 order by acquired_on desc",
      [cycle],
    );
    assert.equal(intake.stock_number, "CYCLEA");
    const editIntake = (t: any) => ({
      ...t,
      status: "retail",
      wholesale_on: "",
      wholesale_price: null,
    });
    await cmd({
      type: "update_trade_intake",
      id: intake.id,
      revision: intake.revision,
      trade: editIntake(intake),
    });
    intake = await one("select * from dmcrm_trades where id=$1", [intake.id]);
    await cmd({
      type: "delete_trade_intake",
      id: intake.id,
      revision: intake.revision,
      reason: "Intake created by mistake",
    });
    await cmd({
      type: "unwind_sale",
      opportunity_id: cycle,
      reason: "Sale entered in error",
    });
    assert.equal(
      (
        await one("select status from dmcrm_inventory where id=$1", [
          saleVehicle,
        ])
      ).status,
      "in_stock",
    );
    await cmd({ type: "close_opportunity", id: cycle, outcome: "sold" });
    const newIntake = await one(
      "select * from dmcrm_trades where opportunity_id=$1 and deleted_at is null",
      [cycle],
    );
    assert.notEqual(newIntake.id, intake.id);
    await cmd({
      type: "update_trade_intake",
      id: newIntake.id,
      revision: newIntake.revision,
      trade: editIntake(newIntake),
    });
    const latestIntake = await one("select * from dmcrm_trades where id=$1", [
      newIntake.id,
    ]);
    assert.notEqual(latestIntake.inventory_id, intake.inventory_id);
    assert.equal(
      (
        await one("select status from dmcrm_inventory where id=$1", [
          latestIntake.inventory_id,
        ])
      ).status,
      "in_stock",
    );
    const revokes = await one(
      "select has_function_privilege('authenticated','dmcrm_attention(uuid,uuid)','EXECUTE') allowed",
    );
    assert.equal(revokes.allowed, false);
  } finally {
    await pg.close();
  }
});
