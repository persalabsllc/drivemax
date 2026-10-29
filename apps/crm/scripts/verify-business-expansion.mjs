import { randomUUID } from "node:crypto";
// Run inside the migration transaction; all fixtures and workflow effects roll back.
export async function verifyBusinessExpansion(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, step) => {
    if (!ok)
      throw Object.assign(Error(`Business expansion: ${step}`), {
        code: "BUSINESS_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint expansion_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint expansion_reject");
    check(denied, "invalid write accepted");
  };
  await client.query("savepoint business_expansion_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "owner");
    const sql = "select dmcrm_command($1,$2,$3::jsonb) id",
      cmd = (p) => one(sql, [org, owner.user_id, JSON.stringify(p)]),
      deny = (p) => reject(sql, [org, owner.user_id, JSON.stringify(p)]);
    const cid = randomUUID(),
      oid = randomUUID(),
      email = `expansion-${cid}@example.invalid`,
      dl = cid.replaceAll("-", "").slice(0, 20);
    const today = (
      await one(
        "select (now() at time zone 'America/New_York')::date::text today",
      )
    ).today;
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,email,person,assigned_to) values($1,$2,'Expansion verification',$3,$4::jsonb,$5)",
      [
        cid,
        org,
        email,
        JSON.stringify({ license_state: "NC", license_number: dl }),
        owner.id,
      ],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'Verification vehicle')",
      [oid, org, cid, owner.id],
    );
    const matches = await client.query(
      "select * from dmcrm_customer_matches($1,$2,$3::jsonb)",
      [
        org,
        owner.user_id,
        JSON.stringify({
          email: email.toUpperCase(),
          phone: "",
          license_state: "NC",
          license_number: dl.toLowerCase(),
        }),
      ],
    );
    check(
      matches.rows.length === 1 &&
        matches.rows[0].id === cid &&
        matches.rows[0].reasons.length === 2,
      "case-normalized contact and license match",
    );
    const customer = {
      name: "Reviewed separate verification",
      phone: "",
      email,
      source: "Other",
      status: "new",
      vehicle_interest: "",
      trade_vehicle: "",
      birthday: null,
      initial_opportunity: false,
    };
    await deny({ type: "create_customer", customer });
    const separate = (
      await cmd({
        type: "create_customer",
        customer: { ...customer, duplicate_reviewed_ids: [cid] },
      })
    ).id;
    check(separate !== cid, "intentional separate profile");
    await deny({
      type: "create_customer",
      customer: { ...customer, duplicate_reviewed_ids: [cid] },
    });
    await reject("select * from dmcrm_customer_matches($1,$2,$3::jsonb)", [
      org,
      randomUUID(),
      JSON.stringify({ email }),
    ]);
    const quick = {
      type: "convert_quick_quote_existing",
      id: randomUUID(),
      customer_id: cid,
      source: "Referral",
      quote: {
        vehicle: "Verification vehicle",
        inventory_id: null,
        values: {
          price: 10000,
          docFee: 399,
          tax: 300,
          titleFee: 114,
          tradeAllowance: 0,
          payoff: 0,
          downPayment: 1500,
          apr: 8,
          months: 60,
          acv: 0,
          recon: 0,
        },
      },
    };
    check(
      (await cmd(quick)).id === cid && (await cmd(quick)).id === cid,
      "existing customer quote retry",
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_quick_quote_conversions where id=$1",
            [quick.id],
          )
        ).n,
      ) === 1,
      "one conversion",
    );
    await deny({ ...quick, customer_id: separate });
    check(
      (await one("select name from dmcrm_customers where id=$1", [cid]))
        .name === "Expansion verification",
      "conversion preserves customer",
    );

    const insurance = {
      company: "Verification insurer",
      agent: "",
      agent_phone: "",
      agent_email: "",
      agent_address: "",
      policy_number: "TEST-42",
      effective_from: today,
      effective_to: today,
      collision_deductible: null,
      comprehensive_deductible: null,
    };
    await cmd({ type: "save_insurance", customer_id: cid, insurance });
    const card = randomUUID(),
      saveCard =
        "select dmcrm_save_insurance_capture($1,$2,$3,$4,$5,$6,$7,$8::jsonb) id",
      args = [
        org,
        owner.user_id,
        cid,
        oid,
        card,
        1200,
        "a".repeat(64),
        JSON.stringify(insurance),
      ];
    check(
      (await one(saveCard, args)).id === card &&
        (await one(saveCard, args)).id === card,
      "insurance idempotent archive",
    );
    await reject(saveCard, [...args.slice(0, 6), "b".repeat(64), args[7]]);
    await reject(saveCard, [
      org,
      randomUUID(),
      cid,
      oid,
      randomUUID(),
      1200,
      "a".repeat(64),
      args[7],
    ]);
    await reject(
      "update dmcrm_deal_files set insurance_values='{}'::jsonb where id=$1",
      [card],
    );
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    await reject(saveCard, [
      org,
      owner.user_id,
      cid,
      oid,
      randomUUID(),
      1200,
      "a".repeat(64),
      args[7],
    ]);
    check(
      (await one(saveCard, args)).id === card,
      "already-filed retry after closing",
    );
    await cmd({
      type: "save_insurance",
      customer_id: cid,
      insurance: { ...insurance, policy_number: "LATER-POLICY" },
    });
    check(
      (
        await one(
          "select sale_snapshot->'insurance'->>'policy_number' policy from dmcrm_opportunities where id=$1",
          [oid],
        )
      ).policy === "TEST-42",
      "closing policy preserved",
    );
    check(
      (
        await one(
          "select insurance_values->>'policy_number' policy from dmcrm_deal_files where id=$1",
          [card],
        )
      ).policy === "TEST-42",
      "card policy preserved",
    );
    const sale = await one(
      "select id,snapshot,accounting from dmcrm_sales where opportunity_id=$1 and status='sold'",
      [oid],
    );
    check(sale?.id, "sold record");
    const plan = {
      type: "save_money_plan",
      request_id: randomUUID(),
      sale_id: sale.id,
      revision: 0,
      plan: {
        expected_lender: 9000.1,
        expected_customer: 1500,
        lender: "Verification lender",
        lender_due: today,
        customer_due: null,
        notes: "Reviewed fixture",
      },
    };
    await cmd(plan);
    await cmd(plan);
    await deny({ ...plan, plan: { ...plan.plan, expected_lender: 1 } });
    await deny({ ...plan, request_id: randomUUID() });
    const receipt = {
      type: "record_money",
      request_id: randomUUID(),
      id: randomUUID(),
      sale_id: sale.id,
      revision: 1,
      kind: "lender",
      amount: 100.1,
      received_on: today,
      method: "ACH",
      reference: "TEST",
      notes: "Verification only",
    };
    await cmd(receipt);
    await cmd(receipt);
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_money_entries where sale_id=$1",
            [sale.id],
          )
        ).n,
      ) === 1,
      "receipt retry deduplication",
    );
    await deny({ ...receipt, request_id: randomUUID(), id: randomUUID() });
    const reverse = {
      type: "reverse_money",
      request_id: randomUUID(),
      id: randomUUID(),
      sale_id: sale.id,
      revision: 2,
      original_id: receipt.id,
      received_on: today,
      reason: "Verification correction",
    };
    await cmd(reverse);
    await cmd(reverse);
    await deny({
      ...reverse,
      request_id: randomUUID(),
      id: randomUUID(),
      revision: 3,
    });
    check(
      Number(
        (
          await one(
            "select sum(case when reversal_of is null then amount else -amount end) total from dmcrm_money_entries where sale_id=$1",
            [sale.id],
          )
        ).total,
      ) === 0,
      "reversal balances",
    );
    await reject("delete from dmcrm_money_entries where id=$1", [receipt.id]);
    const ad = {
      type: "save_ad_spend",
      request_id: randomUUID(),
      id: randomUUID(),
      revision: 0,
      spend: {
        spent_on: today,
        source: "  Facebook  ",
        amount: 125.25,
        campaign: "Verification",
        notes: "Fixture only",
      },
    };
    await cmd(ad);
    await cmd(ad);
    await deny({ ...ad, request_id: randomUUID() });
    await cmd({
      ...ad,
      request_id: randomUUID(),
      revision: 1,
      spend: { ...ad.spend, amount: 0 },
    });
    await cmd({
      type: "void_ad_spend",
      request_id: randomUUID(),
      id: ad.id,
      revision: 2,
      reason: "Verification void",
    });
    await deny({ ...ad, request_id: randomUUID(), revision: 3 });
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_business_events where subject_id=$1",
            [ad.id],
          )
        ).n,
      ) === 3,
      "spend correction history",
    );
    await reject("delete from dmcrm_business_events where id=$1", [
      ad.request_id,
    ]);
    const sales = await one(
      "select s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='sales' limit 1",
      [org],
    );
    if (sales) {
      await reject(sql, [
        org,
        sales.user_id,
        JSON.stringify({ ...plan, request_id: randomUUID(), revision: 3 }),
      ]);
      check(
        !(
          await one("select dmcrm_insurance_access($1,$2,$3,$4) allowed", [
            org,
            sales.user_id,
            cid,
            oid,
          ])
        ).allowed,
        "insurance assignment restriction",
      );
    }
    const after = await one(
      "select snapshot,accounting from dmcrm_sales where id=$1",
      [sale.id],
    );
    check(
      JSON.stringify(after.snapshot) === JSON.stringify(sale.snapshot) &&
        JSON.stringify(after.accounting) === JSON.stringify(sale.accounting),
      "funds do not alter deal accounting",
    );
    await cmd({
      type: "unwind_sale",
      opportunity_id: oid,
      reason: "Verification unwind",
    });
    await deny({ ...plan, request_id: randomUUID(), revision: 3 });
    check(
      !(
        await one(
          "select has_function_privilege('authenticated','public.dmcrm_save_insurance_capture(uuid,uuid,uuid,uuid,uuid,integer,text,jsonb)','execute') allowed",
        )
      ).allowed,
      "private insurance RPC",
    );
  } finally {
    await client.query("rollback to savepoint business_expansion_verification");
  }
}
