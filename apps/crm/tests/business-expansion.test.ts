import { verifyManagementService } from "../scripts/verify-management-service.mjs";
import { verifyProtection } from "../scripts/verify-protection.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, defaultQuote, type Command } from "../lib/model";
import { blankPerson, blankInsurance } from "../lib/people";
import { demoCustomerMatches, matchPhone } from "../lib/customer-matches";
import {
  advertisingReport,
  receivableRows,
  suggestedMoneyPlan,
} from "../lib/business";
import { emptyAccounting, type Sale } from "../lib/operations";
import {
  parseInsuranceText,
  insuranceIdentity,
  matchingInsuranceCard,
} from "../lib/insurance-scan";
import { verifyBusinessExpansion } from "../scripts/verify-business-expansion.mjs";
import { verifyCustomerLinks } from "../scripts/verify-customer-links.mjs";
const now = new Date("2026-10-29T16:00:00Z");
function soldWorkspace() {
  let ws = demoWorkspace(now);
  ws = demoCommand(
    ws,
    { type: "close_opportunity", id: ws.opportunities[0].id, outcome: "sold" },
    now,
  );
  return ws;
}
test("duplicate prevention normalizes shared contacts, respects license state, and requires current match review", () => {
  let ws = demoWorkspace(now);
  const c = ws.customers[0];
  c.phone = "(252) 555-0123";
  c.email = "Case@Example.invalid";
  c.person = { ...blankPerson, license_state: "NC", license_number: "A-01234" };
  const input = {
    phone: "+1 2525550123",
    email: " case@example.invalid ",
    license_state: "NC",
    license_number: "a01234",
  };
  const matches = demoCustomerMatches(ws, input);
  assert.equal(matches[0].id, c.id);
  assert.equal(matches[0].reasons.length, 3);
  assert.equal(matchPhone("123"), "");
  assert.equal(
    demoCustomerMatches(ws, {
      ...input,
      phone: "",
      email: "",
      license_state: "VA",
    }).length,
    0,
  );
  const customer = {
    name: "Separate family member",
    phone: input.phone,
    email: "",
    source: "Walk-in",
    birthday: null,
    status: "new" as const,
    vehicle_interest: "",
    trade_vehicle: "",
    initial_opportunity: false,
  };
  assert.throws(
    () => demoCommand(ws, { type: "create_customer", customer }, now),
    /Possible duplicate/,
  );
  ws = demoCommand(
    ws,
    {
      type: "create_customer",
      customer: {
        ...customer,
        duplicate_reviewed_ids: matches.map((m) => m.id),
      },
    },
    now,
  );
  assert.equal(ws.customers.length, 7);
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          type: "create_customer",
          customer: {
            ...customer,
            duplicate_reviewed_ids: matches.map((m) => m.id),
          },
        },
        now,
      ),
    /Possible duplicate/,
  );
  ws.customer_aliases = [
    {
      id: randomUUID(),
      org_id: ws.org.id,
      merged_at: now.toISOString(),
      customer_id: c.id,
      phone: "2525550188",
      email: "old@example.invalid",
      name: "Previous name",
    },
  ];
  assert.equal(
    demoCustomerMatches(ws, {
      phone: "252-555-0188",
      email: "",
      license_state: "",
      license_number: "",
    })[0].id,
    c.id,
  );
});
test("quick quote can create an opportunity on the existing customer without overwriting their identity or duplicating retries", () => {
  const ws = demoWorkspace(now),
    c = structuredClone(ws.customers[0]);
  const p: Command = {
    type: "convert_quick_quote_existing",
    id: randomUUID(),
    customer_id: c.id,
    source: "Phone",
    quote: {
      inventory_id: null,
      vehicle: "Test car",
      values: { ...defaultQuote, price: 5000 },
    },
  };
  const saved = demoCommand(ws, p, now);
  assert.equal(saved.customers.length, ws.customers.length);
  assert.deepEqual(
    saved.customers.find((x) => x.id === c.id)?.person,
    c.person,
  );
  assert.equal(saved.quotes[0].values.price, 5000);
  assert.deepEqual(demoCommand(saved, p, now), saved);
  assert.throws(
    () => demoCommand(saved, { ...p, customer_id: ws.customers[1].id }, now),
    /unavailable/,
  );
});
test("money totals exclude unreviewed amounts, preserve cents, separate overpayments, and reverse receipts without erasing them", () => {
  let ws = soldWorkspace();
  const sale = ws.sales![0];
  assert.equal(
    receivableRows(ws, "2026-10-29").find((r) => r.sale.id === sale.id)?.due,
    null,
  );
  const plan: Command = {
    type: "save_money_plan",
    request_id: randomUUID(),
    sale_id: sale.id,
    revision: 0,
    plan: {
      expected_lender: 100.1,
      expected_customer: 50.2,
      lender: "Example",
      lender_due: "2026-10-28",
      customer_due: null,
      notes: "",
    },
  };
  ws = demoCommand(ws, plan, now);
  assert.deepEqual(demoCommand(ws, plan, now), ws);
  const receipt: Command = {
    type: "record_money",
    request_id: randomUUID(),
    id: randomUUID(),
    sale_id: sale.id,
    revision: 1,
    kind: "lender",
    amount: 120.1,
    received_on: "2026-10-29",
    method: "ACH",
    reference: "",
    notes: "",
  };
  ws = demoCommand(ws, receipt, now);
  let row = receivableRows(ws, "2026-10-29").find(
    (r) => r.sale.id === sale.id,
  )!;
  assert.equal(row.due, 50.2);
  assert.equal(row.overpayment, 20);
  assert.equal(row.overdue, false);
  assert.deepEqual(demoCommand(ws, receipt, now), ws);
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...receipt, id: randomUUID(), request_id: randomUUID() },
        now,
      ),
    /changed/,
  );
  const correction: Command = {
    type: "reverse_money",
    request_id: randomUUID(),
    id: randomUUID(),
    sale_id: sale.id,
    revision: 2,
    original_id: receipt.id,
    received_on: "2026-10-29",
    reason: "Wrong receipt",
  };
  ws = demoCommand(ws, correction, now);
  row = receivableRows(ws, "2026-10-29").find((r) => r.sale.id === sale.id)!;
  assert.equal(row.due, 150.3);
  assert.equal(row.entries.length, 2);
  assert.equal(row.overdue, true);
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          ...correction,
          request_id: randomUUID(),
          id: randomUUID(),
          revision: 3,
        },
        now,
      ),
    /already been reversed/,
  );
  assert.throws(
    () =>
      demoCommand(
        { ...ws, member: { ...ws.member, role: "sales" } },
        { ...plan, request_id: randomUUID(), revision: 3 },
        now,
      ),
    /Manager/,
  );
  const missing = structuredClone(sale);
  missing.snapshot.quote = null;
  assert.equal(suggestedMoneyPlan(missing, ws).expected_lender, undefined);
});
test("advertising uses Eastern lead cohorts, later sale outcomes, unknown versus zero spend, incomplete costs and excluded unwinds", () => {
  const ws = demoWorkspace(now),
    o = structuredClone(ws.opportunities[0]),
    customer = ws.customers[0];
  o.created_at = "2026-10-02T02:00:00Z";
  o.source = "  FACEbook ";
  o.status = "sold";
  ws.opportunities = [o];
  ws.sales = [
    {
      id: randomUUID(),
      org_id: ws.org.id,
      opportunity_id: o.id,
      customer_id: customer.id,
      sold_on: "2026-10-20",
      created_at: "2026-10-20T16:00:00Z",
      status: "sold",
      snapshot: {
        customer,
        opportunity: o,
        quote: {
          ...ws.quotes[0],
          id: randomUUID(),
          values: { ...defaultQuote, price: 10000, docFee: 0 },
          vehicle: "Test",
          created_at: now.toISOString(),
        },
        salesperson: null,
      },
      accounting: { ...emptyAccounting, vehicle_cost: 7000, recon: 0 },
      revision: 0,
      unwound_at: null,
      unwind_reason: "",
    } as Sale,
  ];
  let report = advertisingReport(ws, "2026-10-01", "2026-10-01");
  assert.equal(report[0].leads, 1);
  assert.equal(report[0].sold, 1);
  assert.equal(report[0].spend, null);
  assert.equal(report[0].afterAdvertising, null);
  ws.ad_spend = [
    {
      id: randomUUID(),
      org_id: ws.org.id,
      source: "facebook",
      amount: 0,
      spent_on: "2026-10-01",
      campaign: "",
      notes: "",
      revision: 1,
      voided_at: null,
      void_reason: "",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
  ];
  report = advertisingReport(ws, "2026-10-01", "2026-10-01");
  assert.equal(report[0].spend, 0);
  assert.equal(report[0].returnPercent, null);
  assert.equal(report[0].gross, 3000);
  assert.equal(report[0].afterAdvertising, 3000);
  ws.sales[0].accounting.vehicle_cost = null;
  report = advertisingReport(ws, "2026-10-01", "2026-10-01");
  assert.equal(report[0].gross, null);
  assert.equal(report[0].afterAdvertising, null);
  assert.equal(report[0].missingGross, 1);
  ws.sales[0].status = "unwound";
  o.status = "working";
  assert.equal(advertisingReport(ws, "2026-10-01", "2026-10-01")[0].sold, 0);
  ws.ad_spend[0].voided_at = now.toISOString();
  assert.equal(
    advertisingReport(ws, "2026-10-01", "2026-10-01")[0].spend,
    null,
  );
});
test("sold packs select the matching policy and exclude later photos and other opportunities", () => {
  const policy = {
    ...blankInsurance,
    company: "Test Mutual",
    policy_number: "TEST-42",
  };
  const before = {
    id: randomUUID(),
    created_at: "2026-10-28T12:00:00Z",
    opportunity_id: "deal-a",
    insurance_values: policy,
  };
  const later = {
    ...before,
    id: randomUUID(),
    created_at: "2026-10-29T12:00:00Z",
  };
  const wrong = { ...before, id: randomUUID(), opportunity_id: "deal-b" };
  assert.equal(
    matchingInsuranceCard(
      [later, wrong, before],
      policy,
      "deal-a",
      "2026-10-28T15:00:00Z",
    )?.id,
    before.id,
  );
  assert.equal(
    matchingInsuranceCard(
      [later, wrong],
      policy,
      "deal-a",
      "2026-10-28T15:00:00Z",
    ),
    null,
  );
  assert.equal(
    matchingInsuranceCard(
      [before],
      { ...policy, policy_number: "NEW" },
      "deal-a",
    ),
    null,
  );
  assert.equal(matchingInsuranceCard([before], null, "deal-a"), null);
});
test("insurance OCR parses labels and date layouts while leaving missing fields and identifier characters for review", () => {
  const r = parseInsuranceText(
    "PROGRESSIVE\nPolicy Number: 0O1I-2345\nEffective Date: 10/29/2026\nExpiration Date: 04/29/2027\nVIN 1HGCM82633A004352",
  );
  assert.equal(r.suggestions.company, "PROGRESSIVE");
  assert.equal(r.suggestions.policy_number, "0O1I-2345");
  assert.equal(r.suggestions.effective_from, "2026-10-29");
  assert.equal(r.suggestions.effective_to, "2027-04-29");
  assert.equal(r.vin, "1HGCM82633A004352");
  const columns = parseInsuranceText(
    "Company: Test Mutual\nPOLICY NUMBER\nTEST1234\nEFFECTIVE DATE EXPIRATION DATE\n10/01/26 10/01/27",
  );
  assert.equal(columns.suggestions.company, "Test Mutual");
  assert.equal(columns.suggestions.effective_to, "2027-10-01");
  assert.equal(
    parseInsuranceText("Expired card\nEffective 02/30/2026").suggestions
      .effective_from,
    undefined,
  );
  assert.equal(parseInsuranceText("unreadable card").warnings.length, 3);
  assert.equal(
    insuranceIdentity({
      ...blankInsurance,
      company: "ABC",
      policy_number: "0012",
    }),
    insuranceIdentity({
      ...blankInsurance,
      company: "abc ",
      policy_number: "0012",
      agent: "Changed",
    }),
  );
  assert.notEqual(
    insuranceIdentity({ ...blankInsurance, policy_number: "0012" }),
    insuranceIdentity({ ...blankInsurance, policy_number: "012" }),
  );
});
test("database release checks enforce duplicate review, money and advertising history, private insurance and preserved closing records", async () => {
  const pg = new PGlite(),
    owner = randomUUID(),
    sales = randomUUID(),
    org = "d5a1c100-0000-4000-8000-000000000001";
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
      "insert into auth.users(id,email) values($1,'expansion-owner@example.invalid'),($2,'expansion-sales@example.invalid')",
      [owner, sales],
    );
    await pg.query(
      "insert into staff(id,email,name,role) values($1,'expansion-owner@example.invalid','Test Owner','owner')",
      [owner],
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Test Sales','sales')",
      [org, sales],
    );
    await pg.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Test Sales','expansion-sales@example.invalid','sales')",
      [org, sales],
    );
    await pg.exec("begin");
    await verifyBusinessExpansion(pg);
    await verifyManagementService(pg);
    await verifyProtection(pg);
    await verifyCustomerLinks(pg);
    for (const [file, name] of [
      ["website-intake", "verifyWebsiteIntake"],
      ["inventory-website", "verifyInventoryWebsite"],
      ["email", "verifyEmail"],
      ["workflows", "verifyWorkflows"],
      ["appraisals", "verifyAppraisals"],
      ["document-vault", "verifyDocumentVault"],
      ["title-clerk", "verifyTitleClerk"],
      ["facebook", "verifyFacebook"],
      ["customer-licenses", "verifyCustomerLicenses"],
    ]) {
      const verification = await import(`../scripts/verify-${file}.mjs`);
      await verification[name](pg);
    }
    await pg.exec("commit");
  } finally {
    await pg.close();
  }
});
