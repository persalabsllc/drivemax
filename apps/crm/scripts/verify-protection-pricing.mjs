import { randomUUID } from "node:crypto";
// Runs in both PGlite tests and the real production migration transaction.
// Every fixture, including rate activation, is rolled back before returning.
export async function verifyProtectionPricing(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok)
      throw Object.assign(Error(`Protection pricing: ${label}`), {
        code: "PROTECTION_PRICING_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint pricing_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint pricing_reject");
    check(denied, "invalid mutation accepted");
  };
  await client.query("savepoint protection_pricing_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "active owner");
    await client.query("delete from dmcrm_product_pricing where org_id=$1", [
      org,
    ]);
    const sql = "select dmcrm_command($1,$2,$3::jsonb) id";
    const cmd = (p) => one(sql, [org, owner.user_id, JSON.stringify(p)]);
    const deny = (p, actor = owner.user_id) =>
      reject(sql, [org, actor, JSON.stringify(p)]);
    const config = {
      rates: {
        deluxe: { basis: "annual_mileage", amount: 399 },
        platinum: { basis: "annual_mileage", amount: 599 },
        maintenance: { basis: "visit", amount: 125 },
        tire_wheel: { basis: "annual", amount: 87 },
        pdr: { basis: "annual", amount: 65 },
        appearance: { basis: "flat", amount: 199 },
        key_replacement: { basis: "annual", amount: 75 },
      },
      annual_miles: 12000,
      maintenance_interval: 5000,
      reserve_percent: 40,
      account_name: "Fictional claims fund",
    };
    const save = {
      type: "save_product_pricing",
      request_id: randomUUID(),
      revision: 0,
      config,
    };
    await cmd(save);
    await cmd(save);
    check(
      (
        await one(
          "select active,revision from dmcrm_product_pricing where org_id=$1",
          [org],
        )
      ).active === null,
      "draft must not activate",
    );
    await deny({ ...save, request_id: randomUUID() });
    await deny({
      ...save,
      request_id: randomUUID(),
      revision: 1,
      config: { ...config, annual_miles: 0 },
    });
    await deny({
      type: "activate_product_pricing",
      request_id: randomUUID(),
      revision: 1,
    });
    const salesman = randomUUID();
    await client.query("insert into auth.users(id,email) values($1,$2)", [
      salesman,
      `pricing-${salesman}@example.invalid`,
    ]);
    await client.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Fictional Pricing Sales','sales')",
      [org, salesman],
    );
    await client.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Fictional Pricing Sales',$3,'sales')",
      [org, salesman, `pricing-${salesman}@example.invalid`],
    );
    await deny({ ...save, request_id: randomUUID(), revision: 1 }, salesman);
    await cmd({
      type: "activate_product_pricing",
      request_id: randomUUID(),
      revision: 1,
      approved: true,
    });
    const cost = async (p) =>
      (
        await one("select dmcrm_protection_cost($1::jsonb,$2::jsonb,2) value", [
          JSON.stringify(p),
          JSON.stringify(config),
        ])
      ).value;
    check(
      (
        await cost({
          protection_plan: "deluxe",
          term_months: 24,
          mileage_limit: 36000,
          price: 2000,
        })
      ).cost === 1197,
      "mileage scales service reserve",
    );
    check(
      (
        await cost({
          protection_plan: "maintenance",
          term_months: 24,
          maintenance_visits: 6,
          price: 1000,
        })
      ).cost === 750,
      "maintenance per visit",
    );
    check(
      (
        await cost({
          protection_plan: "tire_wheel",
          term_months: 18,
          unlimited_miles: true,
          price: 100,
        })
      ).cost === 130.5,
      "partial annual term",
    );
    const cid = randomUUID(),
      oid = randomUUID();
    const today = (
      await one(
        "select (now() at time zone 'America/New_York')::date::text today",
      )
    ).today;
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional Pricing Customer',$3)",
      [cid, org, owner.id],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'2021 Chevrolet Tahoe')",
      [oid, org, cid, owner.id],
    );
    const common = {
      customer_id: cid,
      opportunity_id: oid,
      holder_name: "Fictional Pricing Customer",
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
      issued_on: today,
      start_miles: 60000,
      lender: "",
      lender_address: "",
      dealer_sold: true,
    };
    const product = {
      id: randomUUID(),
      kind: "appearance",
      protection_plan: "appearance",
      provider: "Drive Max",
      contract_number: "",
      name: "Appearance",
      description: "",
      term_months: 96,
      mileage_limit: 0,
      unlimited_miles: true,
      deductible: 0,
      price: 1000,
      cost: 400,
      notes: "",
    };
    product.pricing_snapshot = await cost(product);
    const values = {
      price: 18000,
      docFee: 399,
      titleFee: 114,
      tradeAllowance: 0,
      payoff: 0,
      acv: 0,
      downPayment: 2000,
      apr: 10,
      months: 60,
      tax: 0,
      addOns: 0,
      otherTaxes: 0,
      serviceContract: 1000,
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
    const quote = {
      type: "save_quote",
      customer_id: cid,
      opportunity_id: oid,
      vehicle: "2021 Chevrolet Tahoe",
      values,
    };
    const forged = structuredClone(quote);
    forged.values.products[0].cost = 1;
    await deny(forged);
    const q = await cmd(quote);
    config.rates.appearance.amount = 800;
    await cmd({
      type: "save_product_pricing",
      request_id: randomUUID(),
      revision: 2,
      config,
    });
    check(
      (
        await one(
          "select active#>>'{rates,appearance,amount}' amount from dmcrm_product_pricing where org_id=$1",
          [org],
        )
      ).amount === "199",
      "draft edits retain active rates",
    );
    await cmd({
      type: "activate_product_pricing",
      request_id: randomUUID(),
      revision: 3,
      approved: true,
    });
    await deny(quote);
    const issue = {
      type: "issue_protection",
      id: randomUUID(),
      request_id: randomUUID(),
      contract: {
        ...common,
        quote_id: q.id,
        product_id: product.id,
        plan: "appearance",
        deductible: 0,
        price: 1000,
        term_months: 96,
        term_miles: null,
        claim_limit: null,
      },
    };
    await cmd(issue);
    await cmd(issue);
    check(
      Number(
        (
          await one(
            "select internal_cost from dmcrm_protection_contracts where id=$1",
            [issue.id],
          )
        ).internal_cost,
      ) === 400,
      "linked issuance freezes quoted cost",
    );
    const standalone = {
      ...issue,
      id: randomUUID(),
      request_id: randomUUID(),
      contract: { ...issue.contract, quote_id: null, product_id: null },
    };
    await cmd(standalone);
    check(
      Number(
        (
          await one(
            "select internal_cost from dmcrm_protection_contracts where id=$1",
            [standalone.id],
          )
        ).internal_cost,
      ) === 800,
      "standalone uses active cost",
    );
    await reject(
      "update dmcrm_protection_contracts set internal_cost=1 where id=$1",
      [issue.id],
    );
    const deposit = {
      type: "record_protection_fund",
      request_id: randomUUID(),
      direction: "in",
      amount: 1200,
      posted_on: today,
      reference: "Fictional transfer",
      notes: "Verification only",
      contract_id: null,
    };
    await cmd(deposit);
    await cmd(deposit);
    await deny({ ...deposit, amount: 1300 });
    await deny({ ...deposit, request_id: randomUUID() }, salesman);
    const claim = {
      type: "record_protection_claim",
      id: issue.id,
      request_id: randomUUID(),
      revision: 1,
      amount: 50,
      paid_on: today,
      reference: "Fictional claim",
      description: "Fictional covered repair",
      service_on: today,
      mileage: 60001,
      units: 1,
    };
    await cmd(claim);
    check(
      !(await one("select id from dmcrm_protection_fund_entries where id=$1", [
        claim.request_id,
      ])),
      "no assumed bank withdrawal",
    );
    const funded = {
      ...claim,
      request_id: randomUUID(),
      revision: 2,
      reference: "Fictional funded claim",
      paid_from_fund: true,
    };
    await cmd(funded);
    await cmd(funded);
    check(
      Number(
        (
          await one(
            "select amount from dmcrm_protection_fund_entries where id=$1",
            [funded.request_id],
          )
        ).amount,
      ) === 50,
      "explicit claim withdrawal",
    );
    const reversal = {
      type: "reverse_protection_fund",
      request_id: randomUUID(),
      id: deposit.request_id,
      posted_on: today,
      reason: "Fictional correction",
    };
    await cmd(reversal);
    await cmd(reversal);
    await deny({ ...reversal, request_id: randomUUID() });
    await reject("delete from dmcrm_protection_fund_entries where id=$1", [
      deposit.request_id,
    ]);
    await reject("update dmcrm_pricing_events set command='{}' where id=$1", [
      save.request_id,
    ]);
    for (const table of [
      "product_pricing",
      "pricing_events",
      "protection_fund_entries",
    ]) {
      const grants = await one(
        "select has_table_privilege('anon',$1,'select') a,has_table_privilege('authenticated',$1,'select') b",
        ["dmcrm_" + table],
      );
      check(!grants.a && !grants.b, "private tables");
    }
    await cmd({
      type: "pause_product_pricing",
      request_id: randomUUID(),
      revision: 4,
    });
    check(
      (
        await one("select active from dmcrm_product_pricing where org_id=$1", [
          org,
        ])
      ).active === null,
      "owner can pause new pricing",
    );
    const corrected = structuredClone(config);
    corrected.rates.deluxe.basis = "first_limit";
    corrected.rates.platinum.basis = "first_limit";
    corrected.deductible_discounts = { 0: 0, 250: 10, 500: 20, 1000: 35 };
    await deny({
      type: "save_product_pricing",
      request_id: randomUUID(),
      revision: 5,
      config: {
        ...corrected,
        deductible_discounts: { 0: 0, 250: 50, 500: 20, 1000: 35 },
      },
    });
    await cmd({
      type: "save_product_pricing",
      request_id: randomUUID(),
      revision: 5,
      config: corrected,
    });
    await cmd({
      type: "activate_product_pricing",
      request_id: randomUUID(),
      revision: 6,
      approved: true,
    });
    const shortCost = async (p) =>
      (
        await one("select dmcrm_protection_cost($1::jsonb,$2::jsonb,7) value", [
          JSON.stringify(p),
          JSON.stringify(corrected),
        ])
      ).value;
    const shortProduct = {
      ...product,
      id: randomUUID(),
      kind: "service_contract",
      protection_plan: "deluxe",
      name: "Deluxe",
      term_months: 6,
      mileage_limit: 6000,
      unlimited_miles: false,
      deductible: 500,
      price: 300,
      claim_limit: 5000,
    };
    shortProduct.pricing_snapshot = await shortCost(shortProduct);
    shortProduct.cost = shortProduct.pricing_snapshot.cost;
    check(shortProduct.cost === 159.6, "six-month deductible-adjusted cost");
    const floor = await shortCost({
      ...shortProduct,
      protection_plan: "platinum",
      mileage_limit: 36000,
      price: 800,
    });
    check(
      floor.scheduled_cost === 239.6 && floor.cost === 320,
      "short term with high mileage and separate funding floor",
    );
    const shortOpportunity = randomUUID();
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'2021 Chevrolet Tahoe')",
      [shortOpportunity, org, cid, owner.id],
    );
    const shortQuote = {
      ...quote,
      opportunity_id: shortOpportunity,
      values: {
        ...values,
        serviceContract: 300,
        products: [shortProduct],
        fiMenu: {
          ...values.fiMenu,
          products: [shortProduct],
          packages: values.fiMenu.packages.map((p) => ({
            ...p,
            product_ids: [shortProduct.id],
          })),
        },
      },
    };
    const staleDeductible = structuredClone(shortQuote);
    staleDeductible.values.products[0].deductible = 0;
    await deny(staleDeductible);
    const shortSaved = await cmd(shortQuote);
    const shortIssue = {
      ...issue,
      id: randomUUID(),
      request_id: randomUUID(),
      contract: {
        ...common,
        opportunity_id: shortOpportunity,
        quote_id: shortSaved.id,
        product_id: shortProduct.id,
        plan: "deluxe",
        term_months: 6,
        term_miles: 6000,
        deductible: 500,
        price: 300,
        claim_limit: 5000,
      },
    };
    await cmd(shortIssue);
    const shortStandalone = {
      ...shortIssue,
      id: randomUUID(),
      request_id: randomUUID(),
      contract: { ...shortIssue.contract, quote_id: null, product_id: null },
    };
    await cmd(shortStandalone);
    for (const id of [shortIssue.id, shortStandalone.id]) {
      const row = await one(
        "select internal_cost,pricing_snapshot from dmcrm_protection_contracts where id=$1",
        [id],
      );
      check(
        Number(row.internal_cost) === 159.6 &&
          row.pricing_snapshot.deductible === 500 &&
          row.pricing_snapshot.deductible_discount_percent === 20,
        "menu and standalone issuance agree on deductible cost",
      );
    }
    corrected.rates.deluxe.amount = 799;
    await cmd({
      type: "save_product_pricing",
      request_id: randomUUID(),
      revision: 7,
      config: corrected,
    });
    await cmd({
      type: "activate_product_pricing",
      request_id: randomUUID(),
      revision: 8,
      approved: true,
    });
    check(
      Number(
        (
          await one(
            "select internal_cost from dmcrm_protection_contracts where id=$1",
            [shortIssue.id],
          )
        ).internal_cost,
      ) === 159.6,
      "issued short-term contract keeps its saved allocation",
    );
    check(
      Number(
        (
          await one(
            "select internal_cost from dmcrm_protection_contracts where id=$1",
            [issue.id],
          )
        ).internal_cost,
      ) === 400,
      "legacy issued contract keeps its saved allocation",
    );
  } finally {
    await client.query("rollback to savepoint protection_pricing_verification");
  }
}
