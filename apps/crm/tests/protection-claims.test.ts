import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, commandSchema, type Workspace } from "../lib/model";
import {
  claimPayoutSummary,
  claimPeriodRange,
  type ProtectionClaim,
} from "../lib/protection-claims";
import {
  protectionIssuer,
  protectionVersion,
  type ProtectionContract,
} from "../lib/protection";
const now = new Date("2026-10-31T16:00:00Z");
function setup() {
  const ws = demoWorkspace(now);
  const contract: ProtectionContract = {
    id: randomUUID(),
    org_id: ws.org.id,
    customer_id: ws.customers[0].id,
    opportunity_id: null,
    quote_id: null,
    product_id: null,
    holder_name: "Jordan Ellis",
    co_holder: "",
    address: "123 Example Lane",
    city: "New Bern",
    state: "NC",
    zip: "28562",
    phone: "252-555-0100",
    email: "",
    vin: "1GNSKDKD7MR100250",
    year: 2021,
    make: "Chevrolet",
    model: "Tahoe",
    stock_number: "TEST",
    plan: "platinum",
    deductible: 250,
    price: 1995,
    issued_on: "2025-01-01",
    start_miles: 60000,
    term_months: 48,
    term_miles: 48000,
    expires_on: "2029-01-01",
    expires_miles: 108000,
    claim_limit: 10000,
    lender: "",
    lender_address: "",
    dealer_sold: true,
    status: "active",
    contract_number: "DMP-TEST",
    claims_paid: 0,
    cancellation: null,
    revision: 1,
    terms_version: protectionVersion,
    issuer: protectionIssuer,
    created_at: now.toISOString(),
    created_by: ws.member.id,
  };
  ws.protection_contracts = [contract];
  const submit = {
    type: "submit_protection_claim" as const,
    id: randomUUID(),
    request_id: randomUUID(),
    contract_id: contract.id,
    details: {
      submitted_on: "2026-09-30",
      service_on: "2026-09-29",
      mileage: 65000,
      units: 1,
      description: "Alternator repair",
      repairer: "Example Garage",
      requested_amount: 500,
    },
  };
  return { ws, contract, submit };
}
test("claim submission, edits and payment are audited and retry-safe without duplicate payouts", () => {
  const { ws: original, submit, contract } = setup();
  let ws = demoCommand(original, submit, now);
  assert.equal(original.protection_claims, undefined);
  assert.equal(ws.protection_claims![0].status, "open");
  assert.equal(ws.protection_contracts![0].claims_paid, 0);
  assert.equal(ws.protection_fund_entries?.length ?? 0, 0);
  ws = demoCommand(ws, submit, now);
  assert.equal(ws.protection_claims!.length, 1);
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          ...submit,
          details: { ...submit.details, description: "Changed details" },
        },
        now,
      ),
    /new request key/,
  );
  const edit = {
    type: "update_protection_claim" as const,
    id: submit.id,
    request_id: randomUUID(),
    revision: 1,
    details: { ...submit.details, requested_amount: 525 },
  };
  ws = demoCommand(ws, edit, now);
  ws = demoCommand(ws, edit, now);
  assert.equal(ws.protection_claims![0].revision, 2);
  assert.throws(
    () => demoCommand(ws, { ...edit, request_id: randomUUID() }, now),
    /Claim changed/,
  );
  const pay = {
    type: "pay_protection_claim" as const,
    id: submit.id,
    request_id: randomUUID(),
    revision: 2,
    contract_revision: 1,
    amount: 487.25,
    paid_on: "2026-10-01",
    reference: "CHECK-TEST",
    paid_from_fund: true,
  };
  assert.throws(
    () => demoCommand(ws, { ...pay, amount: 10001 }, now),
    /benefit limit/,
  );
  assert.throws(
    () => demoCommand(ws, { ...pay, contract_revision: 2 }, now),
    /Contract changed/,
  );
  assert.throws(
    () => demoCommand(ws, { ...pay, paid_on: "2026-09-29" }, now),
    /precede claim/,
  );
  ws = demoCommand(ws, pay, now);
  ws = demoCommand(ws, pay, now);
  assert.equal(ws.protection_claims!.length, 1);
  assert.equal(ws.protection_claims![0].status, "paid");
  assert.equal(ws.protection_contracts![0].claims_paid, 487.25);
  assert.equal(ws.protection_fund_entries!.length, 1);
  assert.equal(ws.protection_fund_entries![0].amount, 487.25);
  assert.equal(ws.protection_claim_events!.length, 3);
  assert.equal(
    ws.protection_events!.filter((e) => e.action === "record_protection_claim")
      .length,
    1,
  );
  assert.equal(ws.protection_claims![0].contract_id, contract.id);
  assert.equal(
    claimPayoutSummary(ws.protection_claims!, "2026-09", "month").amount,
    0,
  );
  assert.equal(
    claimPayoutSummary(ws.protection_claims!, "2026-10", "month").amount,
    487.25,
  );
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...pay, request_id: randomUUID(), revision: 3, contract_revision: 2 },
        now,
      ),
    /already paid or closed/,
  );
});
test("open claims validate dates and scope; closing without payment leaves benefits and fund unchanged", () => {
  const { ws, submit } = setup();
  assert.throws(
    () =>
      demoCommand(
        { ...ws, member: { ...ws.member, role: "sales" } },
        submit,
        now,
      ),
    /Manager access/,
  );
  assert.throws(
    () => demoCommand(ws, { ...submit, contract_id: randomUUID() }, now),
    /Contract unavailable/,
  );
  for (const invalid of [
    { mileage: 59000 },
    { submitted_on: "2026-11-01" },
    { service_on: "2026-10-01" },
    { units: 2 },
  ])
    assert.throws(
      () =>
        demoCommand(
          ws,
          { ...submit, details: { ...submit.details, ...invalid } },
          now,
        ),
      /dates, mileage or quantity/,
    );
  assert.equal(
    commandSchema.safeParse({
      ...submit,
      details: { ...submit.details, submitted_on: "2026-02-30" },
    }).success,
    false,
  );
  let state = demoCommand(ws, submit, now);
  const close = {
    type: "close_protection_claim" as const,
    id: submit.id,
    request_id: randomUUID(),
    revision: 1,
    closed_on: "2026-10-31",
    reason: "Customer withdrew request",
  };
  state = demoCommand(state, close, now);
  state = demoCommand(state, close, now);
  assert.equal(state.protection_claims![0].status, "closed");
  assert.equal(state.protection_contracts![0].claims_paid, 0);
  assert.equal(state.protection_fund_entries?.length ?? 0, 0);
  assert.equal(
    claimPayoutSummary(state.protection_claims!, "2026-10", "year").count,
    0,
  );
});
test("direct paid claims are tracked without double counting on retry", () => {
  const { ws, contract } = setup();
  const pay = {
    type: "record_protection_claim" as const,
    id: contract.id,
    request_id: randomUUID(),
    revision: 1,
    amount: 200.01,
    paid_on: "2026-10-31",
    reference: "LEGACY-REF",
    description: "Prior recorded repair",
  };
  let state = demoCommand(ws, pay, now);
  state = demoCommand(state, pay, now);
  assert.equal(state.protection_claims!.length, 1);
  assert.equal(state.protection_claims![0].amount, 200.01);
  assert.equal(state.protection_claims![0].payment_event_id, pay.request_id);
  assert.equal(state.protection_claims![0].service_on, null);
});
test("payout reports use calendar payment dates across month, quarter and year boundaries with exact cents", () => {
  assert.deepEqual(claimPeriodRange("2026-12", "quarter"), {
    start: "2026-10-01",
    end: "2027-01-01",
    label: "Q4 2026",
  });
  assert.deepEqual(claimPeriodRange("2026-01", "year"), {
    start: "2026-01-01",
    end: "2027-01-01",
    label: "2026",
  });
  const claims = [
    ["2025-12-31", 99],
    ["2026-01-01", 100],
    ["2026-09-30", 200],
    ["2026-10-01", 0.1],
    ["2026-10-31", 0.2],
    ["2026-12-31", 400],
    ["2027-01-01", 999],
  ].map(
    ([paid_on, amount]) =>
      ({ status: "paid", paid_on, amount }) as ProtectionClaim,
  );
  assert.equal(claimPayoutSummary(claims, "2026-10", "month").amount, 0.3);
  assert.equal(claimPayoutSummary(claims, "2026-10", "quarter").amount, 400.3);
  assert.equal(claimPayoutSummary(claims, "2026-10", "year").amount, 700.3);
  assert.equal(claimPayoutSummary(claims, "2026-10", "year").count, 5);
  assert.equal(claimPeriodRange("2024-02", "month").end, "2024-03-01");
});

test("tracked payments retain coverage, key quantity and maintenance benefit checks", () => {
  for (const plan of ["key_replacement", "maintenance"] as const) {
    const { ws, contract, submit } = setup();
    Object.assign(contract, {
      plan,
      deductible: 0,
      term_miles: null,
      expires_miles: null,
      claim_limit: plan === "maintenance" ? 250 : null,
      maintenance_visits: plan === "maintenance" ? 2 : null,
    });
    const opened = {
      ...submit,
      details: { ...submit.details, units: plan === "key_replacement" ? 2 : 1 },
    };
    let state = demoCommand(ws, opened, now);
    const pay = {
      type: "pay_protection_claim" as const,
      id: submit.id,
      request_id: randomUUID(),
      revision: 1,
      contract_revision: 1,
      amount: plan === "maintenance" ? 125 : 500,
      paid_on: "2026-10-01",
      reference: "LIMIT-ONE",
      paid_from_fund: false,
    };
    if (plan === "maintenance")
      assert.throws(
        () => demoCommand(state, { ...pay, amount: 125.01 }, now),
        /Maintenance/,
      );
    state = demoCommand(state, pay, now);
    const next = { ...opened, id: randomUUID(), request_id: randomUUID() };
    state = demoCommand(state, next, now);
    if (plan === "key_replacement")
      assert.throws(
        () =>
          demoCommand(
            state,
            {
              ...pay,
              id: next.id,
              request_id: randomUUID(),
              contract_revision: 2,
              reference: "LIMIT-TWO",
            },
            now,
          ),
        /Key replacement/,
      );
    assert.equal(
      state.protection_claims!.filter((c) => c.status === "open").length,
      1,
    );
  }
  const { ws, submit } = setup();
  const state = demoCommand(
    ws,
    { ...submit, details: { ...submit.details, mileage: 108000 } },
    now,
  );
  assert.throws(
    () =>
      demoCommand(
        state,
        {
          type: "pay_protection_claim",
          id: submit.id,
          request_id: randomUUID(),
          revision: 1,
          contract_revision: 1,
          paid_on: "2026-10-01",
          amount: 100,
          reference: "OUTSIDE",
          paid_from_fund: false,
        },
        now,
      ),
    /outside coverage/,
  );
  assert.equal(state.protection_claims![0].status, "open");
});
