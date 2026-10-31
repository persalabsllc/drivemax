import { randomUUID } from "node:crypto";

// Release verification: every customer, contract and transaction is rolled back.
export async function verifyProtection(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, detail) => {
    if (!ok)
      throw Object.assign(Error(`Protection: ${detail}`), {
        code: "PROTECTION_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint protection_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint protection_reject");
    check(denied, "invalid write accepted");
  };
  await client.query("savepoint protection_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "active owner");
    const commandSql = "select dmcrm_command($1,$2,$3::jsonb) id";
    const cmd = (p) => one(commandSql, [org, owner.user_id, JSON.stringify(p)]);
    const deny = (p) =>
      reject(commandSql, [org, owner.user_id, JSON.stringify(p)]);
    const cid = randomUUID(),
      oid = randomUUID(),
      id = randomUUID(),
      today = (
        await one(
          "select (now() at time zone 'America/New_York')::date::text today",
        )
      ).today;
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Protection verification',$3)",
      [cid, org, owner.id],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'2021 Chevrolet Tahoe')",
      [oid, org, cid, owner.id],
    );
    const contract = {
      customer_id: cid,
      opportunity_id: null,
      quote_id: null,
      product_id: null,
      holder_name: "Fictional Contract Holder",
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
      stock_number: "VERIFY",
      plan: "platinum",
      deductible: 250,
      price: 2000,
      issued_on: "2024-01-31",
      start_miles: 60000,
      term_months: 36,
      term_miles: 36000,
      claim_limit: 10000,
      lender: "",
      lender_address: "",
      dealer_sold: true,
    };
    const issue = {
      type: "issue_protection",
      request_id: randomUUID(),
      id,
      contract,
    };
    await reject(commandSql, [org, randomUUID(), JSON.stringify(issue)]);
    const sales = await one(
      "select user_id from dmcrm_members where org_id=$1 and role='sales' and active limit 1",
      [org],
    );
    if (sales)
      await reject(commandSql, [org, sales.user_id, JSON.stringify(issue)]);
    check(
      (await cmd(issue)).id === id && (await cmd(issue)).id === id,
      "idempotent issuance",
    );
    const get = () =>
      one("select * from dmcrm_protection_contracts where id=$1", [id]);
    let c = await get();
    check(
      c.contract_number.startsWith("DMP-") &&
        c.expires_miles === 96000 &&
        Number(c.price) === 2000,
      "numbered registration",
    );
    const dates = await one(
      "select expires_on::text,issued_on::text from dmcrm_protection_contracts where id=$1",
      [id],
    );
    check(dates.expires_on === "2027-01-31", "expiration date");
    await deny({ ...issue, request_id: randomUUID() });
    await deny({ ...issue, contract: { ...contract, price: 1 } });
    await reject("update dmcrm_protection_contracts set price=1 where id=$1", [
      id,
    ]);
    await reject("delete from dmcrm_protection_contracts where id=$1", [id]);
    await reject("delete from dmcrm_protection_events where contract_id=$1", [
      id,
    ]);
    for (const patch of [
      { deductible: 100 },
      { term_months: 0 },
      { term_miles: 0 },
      { start_miles: 10.5 },
      { price: 0 },
      { dealer_sold: false },
      { state: "VA" },
      { vin: "bad" },
      { customer_id: randomUUID() },
      { issued_on: "2099-01-01" },
    ])
      await deny({
        ...issue,
        id: randomUUID(),
        request_id: randomUUID(),
        contract: { ...contract, ...patch },
      });
    for (const deductible of [0, 250, 500, 1000]) {
      const eid = randomUUID();
      await cmd({
        ...issue,
        id: eid,
        request_id: randomUUID(),
        contract: {
          ...contract,
          deductible,
          issued_on: "2024-01-31",
          term_months: 1,
        },
      });
      check(
        (
          await one(
            "select expires_on::text d from dmcrm_protection_contracts where id=$1",
            [eid],
          )
        ).d === "2024-02-29",
        "end of month expiration",
      );
    }
    const claim = {
      type: "record_protection_claim",
      id,
      request_id: randomUUID(),
      revision: 1,
      amount: 125.25,
      paid_on: "2024-02-01",
      reference: "VERIFY-CLAIM",
      description: "Covered alternator repair",
    };
    await cmd(claim);
    await cmd(claim);
    c = await get();
    check(
      Number(c.claims_paid) === 125.25 && c.revision === 2,
      "claim exact once",
    );
    await deny({ ...claim, request_id: randomUUID() });
    await deny({
      ...claim,
      request_id: randomUUID(),
      revision: 2,
      amount: 10000,
    });
    const cancel = {
      type: "cancel_protection",
      id,
      request_id: randomUUID(),
      revision: 2,
      canceled_on: "2024-02-29",
      mileage: 78000,
      reason: "Customer request",
      payee: "Fictional Contract Holder",
    };
    await deny({ ...cancel, mileage: 59000 });
    await deny({ ...cancel, canceled_on: "2024-01-01" });
    await cmd(cancel);
    await cmd(cancel);
    c = await get();
    check(
      c.status === "canceled" &&
        c.cancellation.prorated === 1000 &&
        c.cancellation.admin_fee === 100 &&
        c.cancellation.refund === 774.75,
      "mileage refund with paid claim",
    );
    await deny({ ...claim, request_id: randomUUID(), revision: 3 });
    await deny({ ...cancel, request_id: randomUUID(), revision: 3 });
    const refund = {
      type: "record_protection_refund",
      id,
      request_id: randomUUID(),
      revision: 3,
      paid_on: today,
      reference: "VERIFY-CHECK",
    };
    await cmd(refund);
    await cmd(refund);
    c = await get();
    check(
      c.cancellation.payment_reference === "VERIFY-CHECK" && c.revision === 4,
      "refund exact once",
    );
    await deny({ ...refund, request_id: randomUUID(), revision: 4 });
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_protection_events where contract_id=$1",
            [id],
          )
        ).n,
      ) === 4,
      "append-only event count",
    );
    for (const [mileage, on, prorated, fee, refund] of [
      [92400, "2024-02-29", 200, 20, 180],
      [96000, "2024-01-31", 0, 0, 0],
      [60000, "2027-01-31", 0, 0, 0],
    ]) {
      const row = await one(
        "select dmcrm_protection_refund(jsonb_populate_record(null::dmcrm_protection_contracts,$1::jsonb),$2::date,$3) r",
        [
          JSON.stringify({
            ...contract,
            expires_on: "2027-01-31",
            claims_paid: 0,
          }),
          on,
          mileage,
        ],
      );
      check(
        row.r.prorated === prorated &&
          row.r.admin_fee === fee &&
          row.r.refund === refund,
        "expiration and NC fee cap",
      );
    }
    const product = {
      id: randomUUID(),
      kind: "service_contract",
      protection_plan: "deluxe",
      provider: "Drive Max",
      name: "Deluxe",
      description: "",
      contract_number: "",
      term_months: 24,
      mileage_limit: 24000,
      deductible: 500,
      price: 1500,
      cost: 500,
      notes: "",
    };
    const values = {
      price: 18000,
      docFee: 399,
      titleFee: 100,
      tradeAllowance: 0,
      payoff: 0,
      acv: 0,
      downPayment: 2000,
      apr: 10,
      months: 60,
      tax: 0,
      addOns: 0,
      otherTaxes: 0,
      serviceContract: 1500,
      products: [product],
      fiMenu: {
        version: 1,
        products: [product],
        packages: [0, 1, 2, 3].map((n) => ({
          name: "Option " + n,
          product_ids: [product.id],
        })),
        selected: 0,
      },
    };
    const q = await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: oid,
      vehicle: "2021 Chevrolet Tahoe",
      values,
    });
    const menuIssue = {
      ...issue,
      request_id: randomUUID(),
      id: randomUUID(),
      contract: {
        ...contract,
        opportunity_id: oid,
        quote_id: q.id,
        product_id: product.id,
        plan: "deluxe",
        deductible: 500,
        price: 1500,
        term_months: 24,
        term_miles: 24000,
      },
    };
    await deny({
      ...menuIssue,
      contract: { ...menuIssue.contract, price: 1501 },
    });
    await cmd(menuIssue);
    await deny({ ...menuIssue, request_id: randomUUID(), id: randomUUID() });
    await client.query(
      "update dmcrm_opportunities set vehicle_interest='Different vehicle' where id=$1",
      [oid],
    );
    await deny({ ...menuIssue, request_id: randomUUID(), id: randomUUID() });
    // Helper/RPC and table access remain private to the server; no client role bypass.
    const perms = await one(
      "select has_table_privilege('anon','dmcrm_protection_contracts','SELECT') a,has_table_privilege('authenticated','dmcrm_protection_events','SELECT') b,has_function_privilege('authenticated','dmcrm_command(uuid,uuid,jsonb)','EXECUTE') c",
    );
    check(!perms.a && !perms.b && !perms.c, "private contract permissions");
    const otherOrg = randomUUID();
    await client.query(
      "insert into dmcrm_orgs(id,name,slug) values($1,'Protection verification tenant',$2)",
      [otherOrg, "verify-" + otherOrg],
    );
    await client.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Verify owner','owner')",
      [otherOrg, owner.user_id],
    );
    await client.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Verify owner','verify@example.invalid','owner')",
      [otherOrg, owner.user_id],
    );
    await reject(commandSql, [
      otherOrg,
      owner.user_id,
      JSON.stringify({ ...refund, request_id: randomUUID(), revision: 4 }),
    ]);
  } finally {
    await client.query("rollback to savepoint protection_verification");
  }
}
