import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { demoWorkspace } from "../lib/demo";
import { commandSchema, demoCommand, opportunityCustomer } from "../lib/model";
import { blankPerson, fullName, personFromCustomer } from "../lib/people";
import { mergedCustomerDetails } from "../lib/customer-links";
import { searchCustomers } from "../lib/operations";
import { demoAttention } from "../lib/attention";
import { verifyCustomerLinks } from "../scripts/verify-customer-links.mjs";
import {
  clearCoBuyerPaperwork,
  coBuyerPaperworkFields,
} from "../lib/co-buyer-paperwork";
import { documentContext, allForms, fieldKey } from "../lib/documents";

const person = {
  ...blankPerson,
  first_name: "Co",
  last_name: "Buyer",
  phone: "2525550110",
  email: "co@example.invalid",
};
const data = {
  name: "Primary Buyer",
  phone: "2525550100",
  email: "primary@example.invalid",
  person: { ...blankPerson, first_name: "Primary", last_name: "Buyer" },
  source: "Walk-in",
  birthday: null,
  status: "new" as const,
  vehicle_interest: "",
  trade_vehicle: "",
  initial_opportunity: true,
};
const now = new Date("2026-10-28T17:00:00Z");

test("merge and co-buyer commands require review, valid identities and two different profiles", () => {
  const id = randomUUID();
  assert.equal(
    commandSchema.safeParse({
      type: "merge_customers",
      source_id: id,
      target_id: id,
      source_updated_at: "x",
      target_updated_at: "y",
      details_from: "target",
      confirmed: true,
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "merge_customers",
      source_id: id,
      target_id: randomUUID(),
      source_updated_at: "x",
      target_updated_at: "y",
      details_from: "target",
      confirmed: false,
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "set_co_buyer",
      opportunity_id: id,
      expected_updated_at: now.toISOString(),
      link: { mode: "existing", customer_id: "" },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "set_co_buyer",
      opportunity_id: id,
      expected_updated_at: now.toISOString(),
      link: { mode: "new", person: blankPerson },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "create_customer",
      customer: { ...data, co_buyer_link: { mode: "new", person } },
    }).success,
    true,
  );
});

test("new co-buyer has an independent searchable profile; removal preserves it and other opportunities", () => {
  let ws = demoCommand(
    demoWorkspace(),
    {
      type: "create_customer",
      customer: { ...data, co_buyer_link: { mode: "new", person } },
    },
    now,
  );
  const primary = ws.customers[0],
    co = ws.customers.find((c) => c.id === primary.co_buyer_id)!;
  assert.equal(co.name, fullName(person));
  assert.equal(
    ws.opportunities.filter((o) => o.customer_id === co.id).length,
    0,
  );
  assert(
    !demoAttention(ws).items.some(
      (a) => a.kind === "lead" && a.customer_id === co.id,
    ),
  );
  const first = ws.opportunities[0];
  assert.equal(first.co_buyer_id, co.id);
  ws = demoCommand(
    ws,
    {
      type: "create_opportunity",
      customer_id: primary.id,
      opportunity: {
        title: "Other purchase",
        source: "Repeat customer",
        status: "working",
        inventory_id: null,
        vehicle_interest: "",
        vehicle_details: null,
        trade_vehicle: "",
        trade: null,
      },
    },
    now,
  );
  const second = ws.opportunities[0];
  ws = demoCommand(
    ws,
    {
      type: "set_co_buyer",
      opportunity_id: first.id,
      expected_updated_at: first.updated_at,
      link: { mode: "none" },
    },
    now,
  );
  assert.equal(ws.opportunities.find((o) => o.id === first.id)?.co_buyer, null);
  assert.equal(
    documentContext(
      ws,
      ws.customers.find((c) => c.id === primary.id)!,
      ws.opportunities.find((o) => o.id === first.id)!,
    )["co_buyer.name"],
    undefined,
  );
  assert.equal(
    documentContext(
      ws,
      ws.customers.find((c) => c.id === primary.id)!,
      ws.opportunities.find((o) => o.id === second.id)!,
    )["co_buyer.name"],
    "Co Buyer",
  );
  assert.equal(
    ws.opportunities.find((o) => o.id === second.id)?.co_buyer_id,
    co.id,
  );
  assert(ws.customers.some((c) => c.id === co.id));
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          type: "set_co_buyer",
          opportunity_id: first.id,
          expected_updated_at: first.updated_at,
          link: { mode: "existing", customer_id: primary.id },
        },
        now,
      ),
    /own co-buyer/,
  );
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          type: "set_co_buyer",
          opportunity_id: first.id,
          expected_updated_at: "stale",
          link: { mode: "none" },
        },
        now,
      ),
    /Deal changed/,
  );
});

test("co-buyer paperwork reset covers all form bindings and keeps unrelated corrections", () => {
  for (const form of allForms)
    for (const field of form.pages.flatMap((p) => p.fields)) {
      if (field.key?.startsWith("co_buyer.") || field.key === "buyers.names")
        assert(
          coBuyerPaperworkFields[form.id]?.includes(fieldKey(field)),
          `${form.id}: ${field.name}`,
        );
    }
  assert.deepEqual(
    clearCoBuyerPaperwork({
      $common: {
        "co_buyer.name": "Old person",
        "buyers.names": "Old parties",
        "buyer.name": "Keep buyer",
        "deal.balance": "42",
      },
      "bill-of-sale": { cobuyer_name: "Old person", buyer_name: "Keep buyer" },
    }),
    {
      $common: { "buyer.name": "Keep buyer", "deal.balance": "42" },
      "bill-of-sale": { buyer_name: "Keep buyer" },
    },
  );
});

test("deal co-buyer survives closing and printing even when default and current contact details change", () => {
  let ws = demoCommand(
    demoWorkspace(),
    {
      type: "create_customer",
      customer: { ...data, co_buyer_link: { mode: "new", person } },
    },
    now,
  );
  const primary = ws.customers[0],
    opp = ws.opportunities[0];
  ws = demoCommand(
    ws,
    {
      type: "set_co_buyer",
      opportunity_id: opp.id,
      expected_updated_at: opp.updated_at,
      link: { mode: "new", person: { ...person, first_name: "Different" } },
    },
    now,
  );
  const coId = ws.opportunities[0].co_buyer_id!;
  ws = demoCommand(
    ws,
    { type: "close_opportunity", id: opp.id, outcome: "sold" },
    now,
  );
  const before = structuredClone(ws.opportunities[0].sale_snapshot);
  const co = ws.customers.find((c) => c.id === coId)!;
  ws = demoCommand(
    ws,
    {
      type: "update_customer",
      id: co.id,
      customer: {
        ...data,
        name: "Changed Buyer",
        person: { ...person, first_name: "Changed" },
      },
    },
    now,
  );
  const sold = ws.opportunities.find((o) => o.id === opp.id)!;
  assert.deepEqual(sold.sale_snapshot, before);
  assert.equal(
    opportunityCustomer(
      ws.customers.find((c) => c.id === primary.id)!,
      sold,
    ).co_buyer?.first_name,
    "Different",
  );
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          type: "set_co_buyer",
          opportunity_id: opp.id,
          expected_updated_at: sold.updated_at,
          link: { mode: "none" },
        },
        now,
      ),
    /Closed deals/,
  );
});

test("merge consolidates history, preserves sold values and opt-outs, and searches old contact details", () => {
  let ws = demoCommand(
    demoWorkspace(),
    { type: "create_customer", customer: data },
    now,
  );
  const targetId = ws.customers[0].id,
    soldId = ws.opportunities[0].id;
  ws = demoCommand(
    ws,
    { type: "close_opportunity", id: soldId, outcome: "sold" },
    now,
  );
  const snapshot = structuredClone(ws.opportunities[0].sale_snapshot);
  ws = demoCommand(
    ws,
    {
      type: "create_customer",
      customer: {
        ...data,
        name: "Previous Name",
        phone: "2525550999",
        email: "previous@example.invalid",
      },
    },
    now,
  );
  const source = ws.customers[0],
    target = ws.customers.find((c) => c.id === targetId)!;
  source.email_opt_out = true;
  const expected = mergedCustomerDetails(target, source, "source");
  ws = demoCommand(
    ws,
    {
      type: "merge_customers",
      source_id: source.id,
      target_id: target.id,
      source_updated_at: source.updated_at,
      target_updated_at: target.updated_at,
      details_from: "source",
      confirmed: true,
    },
    now,
  );
  const kept = ws.customers.find((c) => c.id === targetId)!;
  assert(!ws.customers.some((c) => c.id === source.id));
  assert.equal(kept.name, expected.name);
  assert(kept.email_opt_out);
  assert.equal(
    ws.opportunities.filter((o) => o.customer_id === targetId).length,
    2,
  );
  assert.deepEqual(
    ws.opportunities.find((o) => o.id === soldId)?.sale_snapshot,
    snapshot,
  );
  assert(
    ws.activities.some(
      (a) => a.customer_id === targetId && a.body.includes("Merged duplicate"),
    ),
  );
  for (const query of [
    "primary@example.invalid",
    "2525550100",
    "previous@example.invalid",
  ]) {
    const found = searchCustomers(ws, {
      query,
      vehicle: "",
      status: "all",
      from: "",
      to: "",
      zip: "",
      radius: 0,
      staff: "",
    });
    assert(found.some((r) => r.customer.id === targetId));
  }
});

test("database relationships preserve every record and reject unauthorized, stale, cross-tenant and self links", async (t) => {
  const pg = new PGlite();
  const org = "d5a1c100-0000-4000-8000-000000000001",
    owner = randomUUID(),
    salesperson = randomUUID();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (value: unknown, actor = owner) =>
    (
      await one("select public.dmcrm_command($1,$2,$3::jsonb) id", [
        org,
        actor,
        JSON.stringify(value),
      ])
    ).id;
  const row = async (table: string, id: string) =>
    (
      await one(
        `select to_jsonb(t) data from public.dmcrm_${table} t where id=$1`,
        [id],
      )
    ).data;
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const file of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    await pg.query(
      "insert into auth.users(id,email) values($1,'owner@example.invalid'),($2,'sales@example.invalid')",
      [owner, salesperson],
    );
    await pg.query(
      "insert into staff(id,email,name,role) values($1,'owner@example.invalid','Test Owner','owner')",
      [owner],
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Sales User','sales')",
      [org, salesperson],
    );
    await pg.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Sales User','sales@example.invalid','sales')",
      [org, salesperson],
    );
    await pg.exec("begin");
    await verifyCustomerLinks(pg);
    await pg.exec("commit");
    await t.test(
      "stored co-buyer identity matches the review for legacy and structured profiles",
      async () => {
        for (const profile of [
          {
            name: "Erika Lee Kratoville",
            phone: "2525550123",
            email: "",
            person: null,
          },
          {
            name: "John David Doe Jr.",
            phone: "",
            email: "john@example.invalid",
            person: null,
          },
          { name: "Single", phone: "", email: "", person: null },
          { name: "Different display name", phone: "", email: "", person },
        ]) {
          const actual = await one(
            "select dmcrm_customer_person(jsonb_populate_record(null::dmcrm_customers,$1::jsonb)) person",
            [JSON.stringify(profile)],
          );
          assert.deepEqual(actual.person, personFromCustomer(profile));
        }
      },
    );
    await t.test(
      "permissions, stale review and complete rollback",
      async () => {
        const sourceId = await cmd({ type: "create_customer", customer: data });
        const targetId = await cmd({
          type: "create_customer",
          customer: { ...data, name: "Target Buyer" },
        });
        const src = await row("customers", sourceId),
          dst = await row("customers", targetId);
        const merge = {
          type: "merge_customers",
          source_id: sourceId,
          target_id: targetId,
          source_updated_at: src.updated_at,
          target_updated_at: dst.updated_at,
          details_from: "target",
          confirmed: true,
        };
        await assert.rejects(
          cmd(merge, salesperson),
          /Manager access required/,
        );
        await assert.rejects(
          cmd({ ...merge, source_updated_at: "2000-01-01T00:00:00Z" }),
          /profiles changed/,
        );
        await assert.rejects(
          cmd({ ...merge, target_id: sourceId }),
          /two different/,
        );
        await assert.rejects(
          cmd({ ...merge, confirmed: false }),
          /Confirm these profiles/,
        );
        const otherOrg = randomUUID(),
          outsider = randomUUID();
        await pg.query(
          "insert into dmcrm_orgs(id,name,slug) values($1,'Other tenant',$2)",
          [otherOrg, otherOrg],
        );
        await pg.query(
          "insert into dmcrm_customers(id,org_id,name) values($1,$2,'Other tenant customer')",
          [outsider, otherOrg],
        );
        await assert.rejects(
          cmd({ ...merge, target_id: outsider }),
          /profiles changed/,
        );
        const op = await one(
          "select to_jsonb(o) data from dmcrm_opportunities o where customer_id=$1",
          [sourceId],
        );
        const selection = {
          type: "set_co_buyer",
          opportunity_id: op.data.id,
          expected_updated_at: op.data.updated_at,
          link: { mode: "existing", customer_id: outsider },
        };
        await assert.rejects(cmd(selection), /Co-buyer profile unavailable/);
        await assert.rejects(
          cmd({
            ...selection,
            link: { mode: "existing", customer_id: sourceId },
          }),
          /own co-buyer/,
        );
        await assert.rejects(
          cmd({ ...selection, link: { mode: "none" } }, salesperson),
          /Assigned salesperson/,
        );
        await cmd({
          ...selection,
          link: { mode: "existing", customer_id: targetId },
        });
        await assert.rejects(cmd(merge), /Remove the co-buyer link/);
        const linked = await row("opportunities", op.data.id);
        await cmd({
          ...selection,
          expected_updated_at: linked.updated_at,
          link: { mode: "none" },
        });
        await cmd({ type: "check_in", customer_id: sourceId });
        await cmd({ type: "check_in", customer_id: targetId });
        await assert.rejects(cmd(merge), /two active visits/);
        assert.equal((await row("customers", sourceId)).merged_into, null);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_customer_merges where source_id=$1",
                [sourceId],
              )
            ).n,
          ),
          0,
        );
        assert.equal(
          (
            await one(
              "select customer_id from dmcrm_opportunities where id=$1",
              [op.data.id],
            )
          ).customer_id,
          sourceId,
        );
        assert.equal((await row("customers", targetId)).email, data.email);
      },
    );
    await t.test(
      "SQL and client clear the same co-buyer overrides",
      async () => {
        const paperwork = {
          $common: {
            "co_buyer.name": "Old",
            "buyers.names": "Old",
            "buyer.name": "Keep",
          },
          ...Object.fromEntries(
            Object.entries(coBuyerPaperworkFields).map(([form, fields]) => [
              form,
              Object.fromEntries([
                ...fields.map((key) => [key, "Old"]),
                ["unrelated", "Keep"],
              ]),
            ]),
          ),
        };
        const actual = await one(
          "select dmcrm_co_buyer_paperwork($1::jsonb) result",
          [JSON.stringify(paperwork)],
        );
        assert.deepEqual(actual.result, clearCoBuyerPaperwork(paperwork));
      },
    );
    await t.test(
      "private helper functions cannot be invoked by authenticated clients",
      async () => {
        await pg.exec("set role authenticated");
        await assert.rejects(
          pg.query("select dmcrm_resolve_customer($1,$2)", [org, randomUUID()]),
          /permission denied/,
        );
        await assert.rejects(
          pg.query("select * from dmcrm_customer_merges"),
          /permission denied/,
        );
        await pg.exec("reset role");
      },
    );
  } finally {
    await pg.close();
  }
});
