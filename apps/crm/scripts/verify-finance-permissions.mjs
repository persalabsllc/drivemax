import { randomUUID } from "node:crypto";
// All identities, quotes and contracts below are fictional and rolled back.
export async function verifyFinancePermissions(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok) throw Error(`Finance permissions: ${label}`);
  };
  const sql = "select dmcrm_command($1,$2,$3::jsonb) id";
  const cmd = (actor, p) => one(sql, [org, actor, JSON.stringify(p)]);
  const reject = async (actor, p) => {
    await client.query("savepoint finance_denied");
    let code;
    try {
      await cmd(actor, p);
    } catch (e) {
      code = e.code;
    }
    await client.query("rollback to savepoint finance_denied");
    check(code === "42501", `permission rejection: ${p.type}`);
  };
  await client.query("savepoint finance_verification");
  try {
    const owner = await one(
      "select user_id from dmcrm_members where org_id=$1 and active and role='owner' limit 1",
      [org],
    );
    check(owner?.user_id, "owner exists");
    const identities = {};
    for (const role of ["finance", "sales", "manager"]) {
      const user = randomUUID(),
        email = `verify-role-${user}@example.invalid`;
      await client.query(
        "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb)",
        [user, email, JSON.stringify({ dmcrm_org_id: org })],
      );
      const details = {
        name: `Fictional ${role}`,
        first_name: "Fictional",
        last_name: role,
        email,
        phone: "+12525550100",
        address1: "123 Example Lane",
        address2: "",
        city: "New Bern",
        state: "NC",
        zip: "28562",
        role,
      };
      const staff = await one(
        "select dmcrm_create_staff_account($1,$2,$3::jsonb,$4) id",
        [org, owner.user_id, JSON.stringify(details), user],
      );
      const actual = await one(
        "select m.role,s.role staff_role from dmcrm_members m join dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=$1 and m.user_id=$2",
        [org, user],
      );
      check(
        actual.role === role && actual.staff_role === role,
        "staff and login roles match",
      );
      identities[role] = { user, staff: staff.id, details };
    }
    const finance = identities.finance.user,
      sales = identities.sales.user;
    for (const actor of [finance, sales])
      for (const type of [
        "save_staff",
        "set_staff_active",
        "save_product_pricing",
        "activate_product_pricing",
        "pause_product_pricing",
        "record_protection_fund",
        "reverse_protection_fund",
        "save_management_report",
        "queue_management_report",
        "save_accounting",
        "save_inventory",
        "delete_inventory",
        "save_email_settings",
        "save_email_template",
        "delete_email_template",
        "save_workflow_rule",
        "delete_workflow_rule",
        "save_ad_spend",
        "merge_customers",
        "save_inventory_prep",
        "save_appraisal",
      ])
        await reject(actor, { type });
    for (const type of [
      "save_quote",
      "convert_quick_quote",
      "convert_quick_quote_existing",
      "issue_protection",
      "issue_protection_batch",
      "cancel_protection",
      "submit_protection_claim",
      "pay_protection_claim",
    ])
      await reject(sales, { type });
    await reject(sales, { type: "save_message", quote_id: randomUUID() });
    await reject(finance, { type: "a_future_admin_command" });
    await reject(identities.manager.user, {
      type: "save_staff",
      staff: {
        ...identities.finance.details,
        email: `another-${randomUUID()}@example.invalid`,
      },
    });
    await reject(finance, {
      type: "save_staff",
      id: identities.finance.staff,
      staff: { ...identities.finance.details, role: "manager" },
    });
    const today = (
      await one(
        "select (now() at time zone 'America/New_York')::date::text today",
      )
    ).today;
    const cid = randomUUID(),
      oid = randomUUID();
    const vehicle = {
      vin: "1GNSKDKD7MR100250",
      year: 2021,
      make: "Chevrolet",
      model: "Tahoe",
      trim: "",
      stock_number: "VERIFY-ROLE",
      mileage: 60000,
      color: "Black",
      cost: 12345,
      recon: 678,
      price: 18000,
      acquired_on: today,
    };
    const trade = {
      vin: "1HGCM82633A004352",
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: "",
      description: "Trade",
      mileage: 100000,
      allowance: 4000,
      acv: 3210,
      payoff: 0,
    };
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional Role Customer',$3)",
      [cid, org, identities.sales.staff],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest,vehicle_details,trade) values($1,$2,$3,$4,'2021 Chevrolet Tahoe',$5::jsonb,$6::jsonb)",
      [
        oid,
        org,
        cid,
        identities.sales.staff,
        JSON.stringify(vehicle),
        JSON.stringify(trade),
      ],
    );
    const values = {
      price: 18000,
      docFee: 399,
      titleFee: 114,
      tradeAllowance: 4000,
      payoff: 0,
      acv: 3210,
      downPayment: 2000,
      apr: 10,
      months: 60,
      tax: 0,
      addOns: 0,
      otherTaxes: 0,
      serviceContract: 0,
      products: [],
    };
    const quote = {
      type: "save_quote",
      customer_id: cid,
      opportunity_id: oid,
      vehicle: "2021 Chevrolet Tahoe",
      values,
    };
    const q = await cmd(finance, quote);
    check(
      Boolean(q.id),
      "finance saves a quote on another salesperson's opportunity",
    );
    await reject(sales, quote);
    await cmd(sales, {
      type: "update_opportunity",
      id: oid,
      opportunity: {
        title: "Test drive",
        source: "Walk-in",
        status: "working",
        assigned_to: identities.sales.staff,
        inventory_id: null,
        vehicle_interest: "2021 Chevrolet Tahoe",
        vehicle_details: { ...vehicle, cost: 1, recon: 2 },
        trade_vehicle: "Trade",
        trade: { ...trade, acv: 3 },
      },
    });
    const after = await one(
      "select vehicle_details,trade from dmcrm_opportunities where id=$1",
      [oid],
    );
    check(
      after.vehicle_details.cost === 12345 &&
        after.vehicle_details.recon === 678 &&
        after.trade.acv === 3210,
      "sales cannot overwrite hidden cost or ACV",
    );
    const contract = {
      customer_id: cid,
      opportunity_id: null,
      quote_id: null,
      product_id: null,
      holder_name: "Fictional Role Customer",
      co_holder: "",
      address: "123 Example Lane",
      city: "New Bern",
      state: "NC",
      zip: "28562",
      phone: "252-555-0100",
      email: "",
      vin: vehicle.vin,
      year: 2021,
      make: "Chevrolet",
      model: "Tahoe",
      stock_number: "VERIFY-ROLE",
      price: 699,
      deductible: 0,
      issued_on: today,
      start_miles: 60000,
      term_months: 12,
      term_miles: 12000,
      claim_limit: null,
      maintenance_visits: null,
      lender: "",
      lender_address: "",
      dealer_sold: true,
    };
    const batch = {
      type: "issue_protection_batch",
      id: randomUUID(),
      request_id: randomUUID(),
      contracts: ["pdr", "key_replacement"].map((plan) => ({
        id: randomUUID(),
        contract: { ...contract, plan },
      })),
    };
    await cmd(finance, batch);
    await cmd(finance, batch);
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_protection_contracts where org_id=$1 and batch_id=$2",
            [org, batch.id],
          )
        ).n,
      ) === 2,
      "finance batch issues exactly once",
    );
    const claimId = randomUUID(),
      contractId = batch.contracts[0].id;
    await cmd(finance, {
      type: "submit_protection_claim",
      id: claimId,
      request_id: randomUUID(),
      contract_id: contractId,
      details: {
        submitted_on: today,
        service_on: today,
        mileage: 60010,
        units: 1,
        description: "Fictional eligible dent",
        repairer: "Fictional Shop",
        requested_amount: 100,
      },
    });
    await cmd(finance, {
      type: "pay_protection_claim",
      id: claimId,
      request_id: randomUUID(),
      revision: 1,
      contract_revision: 1,
      paid_on: today,
      amount: 100,
      reference: "VERIFY-ROLE",
      paid_from_fund: true,
    });
    check(
      (
        await one("select status from dmcrm_protection_claims where id=$1", [
          claimId,
        ])
      ).status === "paid",
      "finance tracks and pays a contract claim",
    );
    check(
      (
        await one("select dmcrm_document_access($1,$2,$3) allowed", [
          org,
          finance,
          oid,
        ])
      ).allowed,
      "finance can file on another salesperson's deal",
    );
    check(
      !(
        await one("select dmcrm_document_access($1,$2,null) allowed", [
          org,
          finance,
        ])
      ).allowed,
      "finance cannot access inventory-only documents",
    );
    check(
      (
        await one("select dmcrm_license_access($1,$2,$3) allowed", [
          org,
          finance,
          cid,
        ])
      ).allowed,
      "finance can include a customer license in desking packets",
    );
    check(
      (
        await one("select dmcrm_insurance_access($1,$2,$3,$4) allowed", [
          org,
          finance,
          cid,
          oid,
        ])
      ).allowed,
      "finance can include deal insurance in desking packets",
    );
    check(
      !(
        await one("select dmcrm_license_access($1,$2,$3) allowed", [
          org,
          finance,
          randomUUID(),
        ])
      ).allowed,
      "finance document access stays scoped to a dealership customer",
    );
    // Role changes affect an existing login immediately, and inactive/mismatched membership fails closed.
    await cmd(owner.user_id, {
      type: "save_staff",
      id: identities.finance.staff,
      staff: { ...identities.finance.details, role: "sales" },
    });
    await reject(finance, quote);
    await client.query(
      "update dmcrm_members set role='finance' where org_id=$1 and user_id=$2",
      [org, finance],
    );
    await reject(finance, quote);
    const permissions = await one(
      "select has_function_privilege('service_role','public.dmcrm_command_before_finance_roles(uuid,uuid,jsonb)','EXECUTE') bypass,has_function_privilege('authenticated','public.dmcrm_command(uuid,uuid,jsonb)','EXECUTE') direct,has_table_privilege('authenticated','public.dmcrm_inventory','SELECT') costs",
    );
    check(
      !permissions.bypass && !permissions.direct && !permissions.costs,
      "no direct SQL bypass for browser roles",
    );
  } finally {
    await client.query("rollback to savepoint finance_verification");
  }
}
