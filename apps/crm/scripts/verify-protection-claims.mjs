import { randomUUID } from "node:crypto";
// Runs against PGlite and production inside a rolled-back savepoint.
export async function verifyProtectionClaims(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok)
      throw Object.assign(Error(`Protection claims: ${label}`), {
        code: "PROTECTION_CLAIMS_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint claim_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint claim_reject");
    check(denied, "invalid mutation accepted");
  };
  await client.query("savepoint protection_claims_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "active owner");
    const dates = await one(
      "select (now() at time zone 'America/New_York')::date::text today, ((now() at time zone 'America/New_York')::date-interval '1 year')::date::text issued, ((now() at time zone 'America/New_York')::date+1)::text future",
    );
    const sql = "select dmcrm_command($1,$2,$3::jsonb) id";
    const cmd = (p) => one(sql, [org, owner.user_id, JSON.stringify(p)]);
    const deny = (p, actor = owner.user_id) =>
      reject(sql, [org, actor, JSON.stringify(p)]);
    const cid = randomUUID(),
      contractId = randomUUID();
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional Claims Holder',$3)",
      [cid, org, owner.id],
    );
    await cmd({
      type: "issue_protection",
      id: contractId,
      request_id: randomUUID(),
      contract: {
        customer_id: cid,
        opportunity_id: null,
        quote_id: null,
        product_id: null,
        holder_name: "Fictional Claims Holder",
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
        stock_number: "VERIFY-CLAIMS",
        plan: "platinum",
        price: 1995,
        deductible: 250,
        issued_on: dates.issued,
        start_miles: 60000,
        term_months: 48,
        term_miles: 48000,
        claim_limit: 10000,
        lender: "",
        lender_address: "",
        dealer_sold: true,
      },
    });
    const details = {
      submitted_on: dates.today,
      service_on: dates.today,
      mileage: 65000,
      units: 1,
      description: "Fictional alternator repair",
      repairer: "Fictional Repair Shop",
      requested_amount: 500,
    };
    const submit = {
      type: "submit_protection_claim",
      id: randomUUID(),
      request_id: randomUUID(),
      contract_id: contractId,
      details,
    };
    await cmd(submit);
    await cmd(submit);
    let cl = await one("select * from dmcrm_protection_claims where id=$1", [
      submit.id,
    ]);
    check(
      cl.status === "open" &&
        cl.revision === 1 &&
        cl.claim_number.startsWith("DMC-"),
      "open claim and retry",
    );
    check(
      Number(
        (
          await one(
            "select claims_paid from dmcrm_protection_contracts where id=$1",
            [contractId],
          )
        ).claims_paid,
      ) === 0,
      "open claim does not affect benefits",
    );
    await deny({ ...submit, details: { ...details, requested_amount: 501 } });
    await deny({ ...submit, request_id: randomUUID() });
    for (const invalid of [
      { submitted_on: dates.future },
      { mileage: 59000 },
      { mileage: 65000.5 },
      { units: 2 },
      { requested_amount: -1 },
      { service_on: dates.future },
    ])
      await deny({
        ...submit,
        id: randomUUID(),
        request_id: randomUUID(),
        details: { ...details, ...invalid },
      });
    await deny({
      ...submit,
      id: randomUUID(),
      request_id: randomUUID(),
      contract_id: randomUUID(),
    });
    const sales = randomUUID();
    await client.query("insert into auth.users(id,email) values($1,$2)", [
      sales,
      `claims-${sales}@example.invalid`,
    ]);
    await client.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Fictional Claims Sales','sales')",
      [org, sales],
    );
    await client.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Fictional Claims Sales',$3,'sales')",
      [org, sales, `claims-${sales}@example.invalid`],
    );
    await deny(
      { ...submit, id: randomUUID(), request_id: randomUUID() },
      sales,
    );
    const edit = {
      type: "update_protection_claim",
      id: submit.id,
      request_id: randomUUID(),
      revision: 1,
      details: { ...details, requested_amount: 525 },
    };
    await cmd(edit);
    await cmd(edit);
    await deny({ ...edit, request_id: randomUUID() });
    const pay = {
      type: "pay_protection_claim",
      id: submit.id,
      request_id: randomUUID(),
      revision: 2,
      contract_revision: 1,
      amount: 487.25,
      paid_on: dates.today,
      reference: "VERIFY-CLAIM-ONE",
      paid_from_fund: true,
    };
    await deny({ ...pay, amount: 10001 });
    await deny({ ...pay, paid_on: dates.issued });
    await deny({ ...pay, contract_revision: 2 });
    await cmd(pay);
    await cmd(pay);
    cl = await one("select * from dmcrm_protection_claims where id=$1", [
      submit.id,
    ]);
    check(
      cl.status === "paid" &&
        cl.revision === 3 &&
        Number(cl.amount) === 487.25 &&
        cl.payment_event_id === pay.request_id,
      "paid lifecycle",
    );
    check(
      Number(
        (
          await one(
            "select claims_paid from dmcrm_protection_contracts where id=$1",
            [contractId],
          )
        ).claims_paid,
      ) === 487.25,
      "contract paid exactly once",
    );
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_protection_claims where contract_id=$1",
          [contractId],
        )
      ).n === 1,
      "no duplicate tracking row",
    );
    check(
      Number(
        (
          await one(
            "select amount from dmcrm_protection_fund_entries where id=$1",
            [pay.request_id],
          )
        ).amount,
      ) === 487.25,
      "fund withdrawal once",
    );
    await deny({
      ...pay,
      request_id: randomUUID(),
      revision: 3,
      contract_revision: 2,
    });
    await reject("update dmcrm_protection_claims set amount=1 where id=$1", [
      submit.id,
    ]);
    await reject("delete from dmcrm_protection_claims where id=$1", [
      submit.id,
    ]);
    await reject(
      "update dmcrm_protection_claim_events set result='{}' where claim_id=$1",
      [submit.id],
    );
    const second = { ...submit, id: randomUUID(), request_id: randomUUID() };
    await cmd(second);
    const close = {
      type: "close_protection_claim",
      id: second.id,
      request_id: randomUUID(),
      revision: 1,
      closed_on: dates.today,
      reason: "Customer withdrew request",
    };
    await cmd(close);
    await cmd(close);
    await deny({
      ...pay,
      id: second.id,
      request_id: randomUUID(),
      revision: 2,
      contract_revision: 2,
    });
    check(
      (
        await one("select status from dmcrm_protection_claims where id=$1", [
          second.id,
        ])
      ).status === "closed",
      "closed without payment",
    );
    // The old paid-claim action remains compatible and automatically tracked.
    const legacy = {
      type: "record_protection_claim",
      id: contractId,
      request_id: randomUUID(),
      revision: 2,
      amount: 125.5,
      paid_on: dates.today,
      reference: "VERIFY-LEGACY-CLAIM",
      description: "Fictional historical payment",
    };
    await cmd(legacy);
    await cmd(legacy);
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_protection_claims where payment_event_id=$1",
          [legacy.request_id],
        )
      ).n === 1,
      "legacy tracking idempotent",
    );
    // Simulate a pre-migration paid event, then exercise the exact backfill helper.
    const historical = {
      ...legacy,
      request_id: randomUUID(),
      revision: 3,
      amount: 50.25,
      reference: "VERIFY-BACKFILL",
    };
    await one("select dmcrm_command_before_claim_tracking($1,$2,$3::jsonb)", [
      org,
      owner.user_id,
      JSON.stringify(historical),
    ]);
    await client.query("select dmcrm_track_paid_protection($1)", [
      historical.request_id,
    ]);
    await client.query("select dmcrm_track_paid_protection($1)", [
      historical.request_id,
    ]);
    const totals = await one(
      "select sum(amount)::numeric paid,count(*)::int n from dmcrm_protection_claims where contract_id=$1 and status='paid'",
      [contractId],
    );
    check(
      Number(totals.paid) === 663 && totals.n === 3,
      "paid totals include legacy and backfill exactly once",
    );
    check(
      Number(
        (
          await one(
            "select claims_paid from dmcrm_protection_contracts where id=$1",
            [contractId],
          )
        ).claims_paid,
      ) === 663,
      "tracking reconciles to contract",
    );
    for (const table of ["protection_claims", "protection_claim_events"]) {
      check(
        (
          await one(
            "select relrowsecurity enabled from pg_class where relname=$1",
            ["dmcrm_" + table],
          )
        ).enabled,
        "private RLS table",
      );
      check(
        !(
          await one(
            "select has_table_privilege('authenticated',$1,'SELECT') allowed",
            ["dmcrm_" + table],
          )
        ).allowed,
        "no direct client reads",
      );
    }
    check(
      !(
        await one(
          "select has_function_privilege('service_role','dmcrm_command_before_claim_tracking(uuid,uuid,jsonb)','EXECUTE') allowed",
        )
      ).allowed,
      "no wrapper bypass",
    );
    check(
      !(
        await one(
          "select has_function_privilege('authenticated','dmcrm_track_paid_protection(uuid)','EXECUTE') allowed",
        )
      ).allowed,
      "no public backfill",
    );
  } finally {
    await client.query("rollback to savepoint protection_claims_verification");
  }
}
