import { randomUUID } from "node:crypto";

// Run inside a transaction. Fixtures and all financial changes are rolled back.
export async function verifyLenderFinance(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok) throw Error(`Lender finance: ${label}`);
  };
  const reject = async (sql, args) => {
    await client.query("savepoint lender_reject");
    let failed = false;
    try {
      await client.query(sql, args);
    } catch {
      failed = true;
    }
    await client.query("rollback to savepoint lender_reject");
    check(failed, "invalid lender data rejected");
  };
  await client.query("savepoint lender_verification");
  try {
    const owner = await one(
      "select m.user_id,s.id from dmcrm_members m join dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=$1 and m.active and s.active and m.role='owner' limit 1",
      [org],
    );
    check(owner, "active owner exists");
    const cmd = (p) =>
      one("select dmcrm_command($1,$2,$3::jsonb) id", [
        org,
        owner.user_id,
        JSON.stringify(p),
      ]);
    const f = {
      lender: "Fictional Bank",
      buyRate: 14,
      payoutPercent: 75,
      reserveOverride: null,
      lenderFees: 300,
    };
    const v = {
      price: 20000,
      docFee: 0,
      titleFee: 0,
      tradeAllowance: 0,
      payoff: 0,
      acv: 0,
      recon: 0,
      downPayment: 0,
      apr: 16,
      months: 60,
      tax: 0,
      taxMode: "manual",
      mode: "finance",
      addOns: 0,
      otherTaxes: 0,
      products: [],
      daysToFirstPayment: 30,
      lenderFinance: f,
      financeOptions: [
        { months: 36, apr: 12 },
        { months: 48, apr: 14 },
        { months: 60, apr: 16, lenderFinance: f },
      ],
      selectedOption: 2,
      selectedDown: 0,
      downPayments: [0, 500, 1000],
    };
    const calc = async (values) =>
      (
        await one("select dmcrm_lender_accounting($1::jsonb) a", [
          JSON.stringify(values),
        ])
      ).a;
    const expected = await calc(v);
    check(
      expected.finance_reserve === 944.55 &&
        expected.lender_fees === 300 &&
        expected.buy_rate === 14,
      "14% buy / 16% customer, 60 months, 75% payout",
    );
    const withoutOptions = { ...v };
    delete withoutOptions.financeOptions;
    check(
      (await calc({ ...withoutOptions, apr: 14 })).finance_reserve === 0,
      "equal rates have no markup reserve",
    );
    check(
      (await calc({ ...withoutOptions, apr: 12 })).finance_reserve === 0,
      "lower customer rate never creates positive reserve",
    );
    check(
      (
        await calc({
          ...withoutOptions,
          lenderFinance: { ...f, reserveOverride: 0 },
        })
      ).finance_reserve === 0,
      "confirmed zero is retained",
    );
    check(
      (
        await calc({
          ...withoutOptions,
          lenderFinance: { ...f, reserveOverride: 500 },
        })
      ).finance_reserve === 500,
      "confirmed settlement overrides formula",
    );
    check(
      Object.keys(await calc({ ...v, mode: "cash" })).length === 0,
      "cash has no reserve or lender fees",
    );
    check(
      (await calc({ ...v, selectedOption: 0 })).finance_reserve === undefined,
      "approval does not bleed into another term",
    );
    for (const bad of [
      { ...f, buyRate: -1 },
      { ...f, buyRate: 51 },
      { ...f, payoutPercent: 101 },
      { ...f, reserveOverride: -1 },
      { ...f, lenderFees: -100 },
      { ...f, lenderFees: "300" },
    ])
      await reject("select dmcrm_lender_accounting($1::jsonb)", [
        JSON.stringify({ ...withoutOptions, lenderFinance: bad }),
      ]);

    const cid = randomUUID(),
      oid = randomUUID();
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional Lender Verification',$3)",
      [cid, org, owner.id],
    );
    const vehicle = {
      vin: "1GNSKDKD7MR100250",
      year: 2021,
      make: "Chevrolet",
      model: "Tahoe",
      trim: "",
      mileage: 60000,
      stock_number: "VERIFY-RESERVE",
      color: "Black",
      cost: 12000,
      recon: 500,
      price: 20000,
    };
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest,vehicle_details) values($1,$2,$3,$4,'2021 Chevrolet Tahoe',$5::jsonb)",
      [oid, org, cid, owner.id, JSON.stringify(vehicle)],
    );
    const command = {
      type: "save_quote",
      customer_id: cid,
      opportunity_id: oid,
      vehicle: "2021 Chevrolet Tahoe",
      values: v,
    };
    const quote = await cmd(command);
    const saved = await one("select values from dmcrm_quotes where id=$1", [
      quote.id,
    ]);
    check(
      JSON.stringify(saved.values.lenderFinance) ===
        JSON.stringify(saved.values.financeOptions[2].lenderFinance),
      "selected lender terms saved with quote",
    );
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    const sale = await one(
      "select * from dmcrm_sales where org_id=$1 and opportunity_id=$2 and status='sold'",
      [org, oid],
    );
    check(
      sale.accounting.finance_reserve === 944.55 &&
        sale.accounting.lender_fees === 300 &&
        sale.accounting.finance_reserve_source === "estimate",
      "sale freezes reserve and fees before commissions",
    );
    const commissions = (
      await client.query("select * from dmcrm_commissions where sale_id=$1", [
        sale.id,
      ])
    ).rows;
    check(
      Number(commissions.find((c) => c.category === "sales")?.amount) === 1800,
      "front commission deducts bank fees",
    );
    check(
      Number(commissions.find((c) => c.category === "fi")?.amount) === 47.23,
      "back commission includes reserve",
    );
    const a = {
      vehicle_cost: null,
      recon: null,
      accessory_cost: 0,
      other_cost: 0,
      finance_reserve: 700,
      lender_fees: 250,
      pack: 0,
      product_costs: {},
      legacy_product_cost: null,
      lender: "Fictional Bank",
      buy_rate: 14,
      notes: "",
      finance_reserve_source: "confirmed",
    };
    await cmd({
      type: "save_accounting",
      sale_id: sale.id,
      revision: sale.revision,
      accounting: a,
      commissions: commissions.map((c) => ({
        ...c,
        amount: Number(c.amount),
        paid_amount: Number(c.paid_amount),
      })),
    });
    const actual = await one(
      "select accounting,revision from dmcrm_sales where id=$1",
      [sale.id],
    );
    check(
      actual.accounting.finance_reserve === 700 &&
        actual.accounting.lender_fees === 250 &&
        actual.revision === 1,
      "actual accounting replaces estimate without double counting",
    );
    const history = await one(
      "select accounting from dmcrm_accounting_history where sale_id=$1 order by revision desc limit 1",
      [sale.id],
    );
    check(
      history.accounting.finance_reserve === 944.55 &&
        history.accounting.lender_fees === 300,
      "correction retains original accounting in audit history",
    );
    await reject(
      "update dmcrm_sales set accounting=jsonb_set(accounting,'{lender_fees}','-1') where id=$1",
      [sale.id],
    );
    await client.query("select dmcrm_record_sale($1,$2)", [org, oid]);
    check(
      (await one("select accounting from dmcrm_sales where id=$1", [sale.id]))
        .accounting.finance_reserve === 700,
      "sale retry preserves confirmed settlement",
    );
  } finally {
    await client.query("rollback to savepoint lender_verification");
  }
}
