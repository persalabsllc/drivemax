import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  commandSchema,
  defaultQuote,
  demoCommand,
  opportunityOpen,
  type Opportunity,
} from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import { blankPerson, blankInsurance } from "../lib/people";
import { highwayUseTax, financePayment, calculateQuote } from "../lib/finance";
import {
  documentContext,
  formValues,
  soldForms,
  mvr2Form,
} from "../lib/documents";
import { buildSoldPack, buildMvr2 } from "../lib/pdf-output";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
const buyer = {
  ...blankPerson,
  first_name: "Sample",
  middle_name: "A",
  last_name: "Buyer",
  suffix: "Jr.",
  license_number: "SAMPLE123",
  address1: "100 Example Lane",
  city: "New Bern",
  zip: "28562",
  email: "sample@example.invalid",
};
const contact = {
  name: "Sample A Buyer Jr.",
  email: "sample@example.invalid",
  phone: "252-555-0100",
  source: "Walk-in",
  status: "new",
  vehicle_interest: "Original vehicle",
  trade_vehicle: "",
  birthday: "1990-02-28",
  person: buyer,
  initial_opportunity: false,
};
const proposal = {
  ...defaultQuote,
  price: 10000,
  docFee: 399,
  addOns: 500,
  serviceContract: 1000,
  tradeAllowance: 2000,
  payoff: 1500,
  titleFee: 100,
  otherTaxes: 70,
  downPayment: 1000,
  mode: "finance" as const,
  taxMode: "auto" as const,
  daysToFirstPayment: 45,
};
const opportunity = {
  title: "Second purchase",
  source: "Repeat customer",
  status: "working" as const,
  inventory_id: null,
  vehicle_interest: "2018 Honda Accord",
  vehicle_details: null,
  trade_vehicle: "",
  trade: null,
};
test("tax and odd-days estimates retain original balances and show added interest", () => {
  assert.equal(highwayUseTax(proposal), 266.97);
  assert.equal(
    highwayUseTax({
      ...proposal,
      payoff: 99999,
      serviceContract: 90000,
      downPayment: 5000,
    }),
    266.97,
  );
  assert.equal(highwayUseTax({ ...proposal, tradeAllowance: 20000 }), 0);
  assert.equal(
    calculateQuote({ ...proposal, taxMode: "manual", tax: 400 }).tax,
    400,
  );
  assert.equal(financePayment(10000, 0, 60, 45).payment, 166.67);
  assert.equal(financePayment(10000, 12, 60, 30).firstPeriodInterest, 0);
  assert.equal(financePayment(10000, 12, 60, 45).firstPeriodInterest, 49.32);
  assert.ok(
    financePayment(10000, 12, 60, 60).payment >
      financePayment(10000, 12, 60, 45).payment,
  );
});
test("buyer, co-buyer, insurance and finance input reject incomplete or invalid data", () => {
  assert.equal(
    commandSchema.safeParse({
      type: "create_customer",
      customer: {
        ...contact,
        co_buyer: { ...blankPerson, first_name: "Co", last_name: "Buyer" },
      },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "create_customer",
      customer: { ...contact, co_buyer: buyer },
    }).success,
    true,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "save_insurance",
      customer_id: crypto.randomUUID(),
      insurance: { ...blankInsurance, effective_from: "2026-02-30" },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "save_quote",
      customer_id: crypto.randomUUID(),
      vehicle: "Test",
      values: { ...proposal, financeOptions: [{ months: 60, apr: 99 }] },
    }).success,
    false,
  );
});
test("demo repeat purchases preserve closed deal and general conversations without an active opportunity", () => {
  let ws = demoWorkspace(),
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  ws = demoCommand(ws, {
    type: "save_insurance",
    customer_id: c.id,
    insurance: { ...blankInsurance, policy_number: "ORIGINAL" },
  });
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: c.id,
    opportunity_id: o.id,
    vehicle: o.vehicle_interest,
    values: proposal,
  });
  ws = demoCommand(ws, {
    type: "close_opportunity",
    id: o.id,
    outcome: "sold",
  });
  const original = structuredClone(
    ws.opportunities.find((x) => x.id === o.id)!,
  );
  ws = demoCommand(ws, {
    type: "create_opportunity",
    customer_id: c.id,
    opportunity,
  });
  const second = ws.opportunities[0];
  ws = demoCommand(ws, {
    type: "save_insurance",
    customer_id: c.id,
    insurance: { ...blankInsurance, policy_number: "NEW" },
  });
  assert.deepEqual(
    ws.opportunities.find((x) => x.id === o.id),
    original,
  );
  assert.throws(
    () =>
      demoCommand(ws, { type: "update_opportunity", id: o.id, opportunity }),
    /read-only/,
  );
  ws = demoCommand(ws, {
    type: "close_opportunity",
    id: second.id,
    outcome: "lost",
    reason: "Changed plans",
  });
  assert.equal(
    ws.opportunities.filter((o) => o.customer_id === c.id && opportunityOpen(o))
      .length,
    0,
  );
  ws = demoCommand(ws, {
    type: "add_activity",
    customer_id: c.id,
    opportunity_id: null,
    kind: "email",
    body: "Incoming message: checking in",
  });
  assert.equal(ws.activities[0].opportunity_id, null);
  assert.equal(
    documentContext(ws, c, original)["insurance.policy_number"],
    "ORIGINAL",
  );
});
test("003 migrates history, isolates opportunities and supports repeated purchases with independent follow-up and paperwork", async () => {
  const pg = new PGlite(),
    owner = "00000000-0000-4000-8000-000000000099",
    stranger = "00000000-0000-4000-8000-000000000098",
    org = "d5a1c100-0000-4000-8000-000000000001",
    org2 = "00000000-0000-4000-8000-000000000097";
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}'),('${stranger}');insert into public.staff values('${owner}','Test owner',true,'owner');`,
    );
    for (const file of ["001_crm.sql", "002_inventory_desking.sql"])
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const cmd = async (p: unknown, orgId = org, actor = owner) =>
      (
        await pg.query<{ id: string }>(
          "select public.dmcrm_command($1,$2,$3::jsonb) id",
          [orgId, actor, JSON.stringify(p)],
        )
      ).rows[0].id;
    const one = async <T>(sql: string, args: unknown[] = []) =>
      (await pg.query<T>(sql, args)).rows[0];
    const cid = await cmd({ type: "create_customer", customer: contact }),
      qid = await cmd({
        type: "save_quote",
        customer_id: cid,
        vehicle: "Original vehicle",
        values: defaultQuote,
      });
    await cmd({ type: "mark_sold", customer_id: cid });
    await pg.exec(
      await fs.readFile(
        new URL("../db/003_opportunities_documents.sql", import.meta.url),
        "utf8",
      ),
    );
    const first = await one<Opportunity>(
      "select * from dmcrm_opportunities where customer_id=$1",
      [cid],
    );
    assert.equal(first.status, "sold");
    assert.equal(first.sale_snapshot?.quote?.id, qid);
    assert.equal(
      (
        await one<{ opportunity_id: string }>(
          "select opportunity_id from dmcrm_quotes where id=$1",
          [qid],
        )
      ).opportunity_id,
      first.id,
    );
    await cmd({
      type: "update_customer",
      id: cid,
      customer: {
        ...contact,
        name: "New name",
        vehicle_interest: "Must not erase history",
      },
    });
    assert.equal(
      (
        await one<Opportunity>(
          "select * from dmcrm_opportunities where id=$1",
          [first.id],
        )
      ).sale_snapshot?.customer.name,
      contact.name,
    );
    const second = await cmd({
        type: "create_opportunity",
        customer_id: cid,
        opportunity,
      }),
      third = await cmd({
        type: "create_opportunity",
        customer_id: cid,
        opportunity: { ...opportunity, title: "Another open purchase" },
      });
    const q2 = await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: second,
      vehicle: opportunity.vehicle_interest,
      values: { ...proposal, tax: 1 },
    });
    assert.equal(
      (
        await one<{ values: { tax: number } }>(
          "select values from dmcrm_quotes where id=$1",
          [q2],
        )
      ).values.tax,
      266.97,
    );
    await cmd({
      type: "save_insurance",
      customer_id: cid,
      insurance: { ...blankInsurance, policy_number: "SOLD-POLICY" },
    });
    const visit = await cmd({
      type: "check_in",
      customer_id: cid,
      opportunity_id: second,
    });
    await cmd({ type: "close_opportunity", id: second, outcome: "sold" });
    await cmd({ type: "close_opportunity", id: second, outcome: "sold" });
    const sold = await one<Opportunity>(
      "select * from dmcrm_opportunities where id=$1",
      [second],
    );
    assert.equal(sold.sale_snapshot?.quote?.id, q2);
    assert.equal(sold.sale_snapshot?.insurance?.policy_number, "SOLD-POLICY");
    assert.equal(
      (
        await one<{ departed_at: null }>(
          "select departed_at from dmcrm_visits where id=$1",
          [visit],
        )
      ).departed_at,
      null,
    );
    await cmd({ type: "check_out", id: visit });
    assert.equal(
      (
        await one<{ outcome: string }>(
          "select outcome from dmcrm_visits where id=$1",
          [visit],
        )
      ).outcome,
      "sold",
    );
    assert.equal(
      (
        await one<{ n: number }>(
          "select count(*)::int n from dmcrm_tasks where opportunity_id=$1 and kind='sold_followup'",
          [second],
        )
      ).n,
      3,
    );
    assert.equal(
      (
        await one<{ n: number }>(
          "select count(*)::int n from dmcrm_tasks where opportunity_id=$1 and kind='unsold_followup' and canceled_at is null",
          [third],
        )
      ).n,
      1,
    );
    await assert.rejects(
      cmd({ type: "update_opportunity", id: second, opportunity }),
      /read-only/,
    );
    await assert.rejects(
      cmd({
        type: "save_quote",
        opportunity_id: second,
        customer_id: cid,
        vehicle: "Overwrite",
        values: defaultQuote,
      }),
      /read-only/,
    );
    await cmd({
      type: "save_paperwork",
      opportunity_id: second,
      revision: 0,
      paperwork: { $common: { "insurance.policy_number": "PRINT-CORRECTION" } },
    });
    await assert.rejects(
      cmd({
        type: "save_paperwork",
        opportunity_id: second,
        revision: 0,
        paperwork: {},
      }),
      /another session/,
    );
    assert.equal(
      (
        await one<Opportunity>(
          "select * from dmcrm_opportunities where id=$1",
          [second],
        )
      ).sale_snapshot?.insurance?.policy_number,
      "SOLD-POLICY",
    );
    const anniversary = await one<{ id: string }>(
      "select id from dmcrm_tasks where opportunity_id=$1 and kind='anniversary'",
      [second],
    );
    await cmd({ type: "complete_task", id: anniversary.id });
    assert.equal(
      (
        await one<{ n: number }>(
          "select count(*)::int n from dmcrm_tasks where opportunity_id=$1 and kind='anniversary' and completed_at is null",
          [second],
        )
      ).n,
      1,
    );
    await cmd({
      type: "close_opportunity",
      id: third,
      outcome: "lost",
      reason: "Not buying",
    });
    await cmd({
      type: "add_activity",
      customer_id: cid,
      opportunity_id: null,
      kind: "sms",
      body: "General message history",
    });
    assert.equal(
      (
        await one<{ opportunity_id: null }>(
          "select opportunity_id from dmcrm_activities where body='General message history'",
        )
      ).opportunity_id,
      null,
    );
    await pg.exec(
      `insert into dmcrm_orgs(id,name,slug) values('${org2}','Other dealer','other');insert into dmcrm_members values('${org2}','${stranger}','Other owner','owner',true);`,
    );
    await assert.rejects(
      cmd(
        {
          type: "save_paperwork",
          opportunity_id: second,
          revision: 1,
          paperwork: {},
        },
        org2,
        stranger,
      ),
      /unavailable/,
    );
    const otherCustomer = await cmd({
      type: "create_customer",
      customer: { ...contact, initial_opportunity: false },
    });
    await assert.rejects(
      cmd({
        type: "add_activity",
        customer_id: otherCustomer,
        opportunity_id: second,
        kind: "note",
        body: "wrong buyer",
      }),
      /unavailable/,
    );
    for (const role of ["anon", "authenticated"]) {
      await pg.exec("set role " + role);
      await assert.rejects(
        pg.query("select * from dmcrm_opportunities"),
        /permission denied/,
      );
      await assert.rejects(
        cmd({ type: "check_in", customer_id: cid }),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
    assert.equal(
      (await one<{ n: number }>("select count(*)::int n from public.staff")).n,
      1,
    );
  } finally {
    await pg.close();
  }
});
test("real templates produce 13 ordered pages; print overrides preserve snapshots; MVR2 has no image or other section", async () => {
  let ws = demoWorkspace(),
    c = ws.customers[0];
  c.person = buyer;
  c.name = contact.name;
  c.co_buyer = { ...buyer, first_name: "Co", middle_name: "" };
  c.insurance = {
    ...blankInsurance,
    company: "Sample Insurance",
    policy_number: "POLICY-123",
  };
  const o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  o.vehicle_details = {
    vin: "1HGCM82633A004352",
    year: 2003,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    mileage: 123456,
    color: "Silver",
    stock_number: "QA-1",
    cost: 3456,
    recon: 500,
    price: 10000,
    acquired_on: "2026-10-01",
  };
  ws = demoCommand(ws, {
    type: "save_quote",
    customer_id: c.id,
    opportunity_id: o.id,
    vehicle: o.vehicle_interest,
    values: proposal,
  });
  const context = documentContext(ws, c, o),
    paperwork = {
      $common: {
        "insurance.policy_number": "CORRECTED",
        "dealer.number": "QA123",
      },
    };
  assert.equal(
    formValues(soldForms[1], context, paperwork).policy_number,
    "CORRECTED",
  );
  assert.equal(c.insurance.policy_number, "POLICY-123");
  assert.equal(
    Object.keys(context).some((k) => k.includes("cost") || k.includes("acv")),
    false,
  );
  const load = async (f: { file: string }) =>
    new Uint8Array(
      await fs.readFile(new URL("../assets/forms/" + f.file, import.meta.url)),
    );
  const bytes = await buildSoldPack(context, paperwork, load),
    pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 13);
  assert.equal(pdf.getForm().getFields().length, 0);
  assert.equal(pdf.getPage(9).getWidth(), soldForms[9].pages[0].width);
  for (const section of [1, 2, 3]) {
    const cal = { ...paperwork, $mvr2: { section: String(section) } };
    const overlay = await buildMvr2(context, cal, load),
      p = await PDFDocument.load(overlay);
    assert.equal(p.getPageCount(), 1);
    assert.equal(
      p
        .getPage(0)
        .node.Resources()
        ?.lookup(PDFName.of("XObject"), PDFDict)
        .keys().length ?? 0,
      0,
    );
    const vals = formValues(mvr2Form, context, cal, section);
    assert.ok(vals[`section${section}.buyer_name_address`]);
    assert.equal(
      vals[`section${section === 1 ? 2 : 1}.buyer_name_address`],
      "",
    );
  }
  // Scratch artifact for visual QA, never a real customer or production record.
  if (process.env.CRM_PDF_QA_DIR) {
    await fs.mkdir(process.env.CRM_PDF_QA_DIR, { recursive: true });
    await fs.writeFile(process.env.CRM_PDF_QA_DIR + "/sold-pack.pdf", bytes);
    await fs.writeFile(
      process.env.CRM_PDF_QA_DIR + "/mvr2-test.pdf",
      await buildMvr2(context, paperwork, load, true),
    );
    await fs.writeFile(
      process.env.CRM_PDF_QA_DIR + "/mvr2-text.pdf",
      await buildMvr2(context, paperwork, load),
    );
  }
});
