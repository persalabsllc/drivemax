import { randomUUID } from "node:crypto";
// All release fixtures live inside this savepoint and are rolled back before commit.
export async function verifyProtectionPackets(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok)
      throw Object.assign(Error(`Protection packets: ${label}`), {
        code: "PROTECTION_PACKETS_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint packet_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint packet_reject");
    check(denied, "invalid mutation accepted");
  };
  await client.query("savepoint protection_packet_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "active owner");
    const commandSql = "select dmcrm_command($1,$2,$3::jsonb) id";
    const cmd = (p) => one(commandSql, [org, owner.user_id, JSON.stringify(p)]),
      deny = (p) => reject(commandSql, [org, owner.user_id, JSON.stringify(p)]);
    const cid = randomUUID(),
      oid = randomUUID(),
      today = (
        await one(
          "select (now() at time zone 'America/New_York')::date::text today",
        )
      ).today;
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional Packet Holder',$3)",
      [cid, org, owner.id],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'2021 Chevrolet Tahoe')",
      [oid, org, cid, owner.id],
    );
    const common = {
      customer_id: cid,
      opportunity_id: oid,
      holder_name: "Fictional Packet Holder",
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
      issued_on: "2024-01-31",
      start_miles: 60000,
      lender: "",
      lender_address: "",
      dealer_sold: true,
    };
    const plans = [
      "platinum",
      "maintenance",
      "tire_wheel",
      "pdr",
      "appearance",
      "key_replacement",
    ];
    const products = plans.map((plan) => ({
      id: randomUUID(),
      kind: plan === "platinum" ? "service_contract" : plan,
      protection_plan: plan,
      provider: "Drive Max",
      contract_number: "",
      name: plan,
      description: "",
      term_months: plan === "appearance" ? 96 : 48,
      mileage_limit: plan === "platinum" ? 48000 : 0,
      unlimited_miles: plan !== "platinum",
      deductible: plan === "platinum" ? 250 : 0,
      price: plan === "platinum" ? 1995 : 499,
      cost: 100,
      notes: "",
      ...(plan === "maintenance" ? { maintenance_visits: 4 } : {}),
      ...(plan === "platinum" ? { claim_limit: 10000 } : {}),
    }));
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
      serviceContract: products.reduce((n, p) => n + p.price, 0),
      products,
      fiMenu: {
        version: 1,
        products,
        packages: [0, 1, 2, 3].map((n) => ({
          name: "Option " + n,
          product_ids: products.map((p) => p.id),
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
    const batch = {
      type: "issue_protection_batch",
      id: randomUUID(),
      request_id: randomUUID(),
      contracts: products.map((p) => ({
        id: randomUUID(),
        contract: {
          ...common,
          quote_id: q.id,
          product_id: p.id,
          plan: p.protection_plan,
          deductible: p.deductible,
          price: p.price,
          term_months: p.term_months,
          term_miles: p.unlimited_miles ? null : p.mileage_limit,
          claim_limit: p.claim_limit ?? (p.kind === "maintenance" ? 500 : null),
          maintenance_visits: p.maintenance_visits ?? null,
        },
      })),
    };
    const bad = structuredClone(batch);
    bad.contracts[5].contract.price++;
    await deny(bad);
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_protection_contracts where id=any($1::uuid[])",
          [batch.contracts.map((x) => x.id)],
        )
      ).n === 0,
      "batch failure rolled back every contract",
    );
    await deny({ ...batch, contracts: batch.contracts.slice(0, 1) });
    const mixed = structuredClone(batch);
    mixed.contracts[5].contract.vin = "1HGCV1F34JA000001";
    await deny(mixed);
    await reject(commandSql, [org, randomUUID(), JSON.stringify(batch)]);
    check(
      (await cmd(batch)).id === batch.id && (await cmd(batch)).id === batch.id,
      "exact-once batch issuance",
    );
    const rows = (
      await client.query(
        "select * from dmcrm_protection_contracts where batch_id=$1 order by serial_no",
        [batch.id],
      )
    ).rows;
    check(rows.length === 6, "six numbered agreements");
    check(
      rows.every((c) => c.customer_id === cid && c.org_id === org),
      "shared tenant and customer",
    );
    check(
      new Set(rows.map((c) => c.contract_number)).size === 6,
      "unique contract numbers",
    );
    check(
      rows.find((c) => c.plan === "appearance").expires_miles === null,
      "unlimited appearance mileage",
    );
    await reject(
      "update dmcrm_protection_contracts set maintenance_visits=7 where id=$1",
      [rows.find((c) => c.plan === "maintenance").id],
    );
    await deny({ ...batch, request_id: randomUUID() });
    const claim = async (
      c,
      on,
      units = 1,
      amount = 100,
      reference = randomUUID(),
    ) => ({
      type: "record_protection_claim",
      id: c.id,
      request_id: randomUUID(),
      revision: (
        await one(
          "select revision from dmcrm_protection_contracts where id=$1",
          [c.id],
        )
      ).revision,
      service_on: on,
      paid_on: today,
      mileage: 61000,
      units,
      amount,
      reference,
      description: "Fictional covered service",
    });
    const key = rows.find((c) => c.plan === "key_replacement");
    await cmd(await claim(key, "2025-01-01"));
    await cmd(await claim(key, "2025-07-01"));
    await deny(await claim(key, "2025-12-31"));
    await deny(await claim(key, "2025-04-01"));
    const third = await claim(key, "2026-01-01");
    await cmd(third);
    await cmd(third);
    await deny(await claim(key, "2026-07-01"));
    check(
      Number(
        (
          await one(
            "select claims_paid from dmcrm_protection_contracts where id=$1",
            [key.id],
          )
        ).claims_paid,
      ) === 300,
      "three-key lifetime payments",
    );
    const maintenance = rows.find((c) => c.plan === "maintenance");
    await deny(await claim(maintenance, "2025-01-01", 1, 125.01));
    for (let i = 0; i < 4; i++) {
      const p = await claim(
        maintenance,
        `2025-0${i + 1}-01`,
        1,
        20,
        `MAINT-${i}`,
      );
      await cmd(p);
      await deny({ ...p, request_id: randomUUID(), revision: p.revision + 1 });
    }
    await deny(await claim(maintenance, "2025-07-01", 1, 20));
    check(
      Number(
        (
          await one(
            "select claims_paid from dmcrm_protection_contracts where id=$1",
            [maintenance.id],
          )
        ).claims_paid,
      ) === 80,
      "maintenance visit count independent of paid dollars",
    );
    const wheel = rows.find((c) => c.plan === "tire_wheel");
    await deny({
      ...(await claim(wheel, "2025-01-01")),
      service_on: undefined,
    });
    await deny({ ...(await claim(wheel, "2025-01-01")), mileage: 59999 });
    await deny(await claim(wheel, "2023-12-31"));
    const appearance = rows.find((c) => c.plan === "appearance");
    const before = await one(
      "select dmcrm_protection_refund(c,'2026-01-31',60000) r,dmcrm_protection_refund(c,'2026-01-31',3000000) high from dmcrm_protection_contracts c where id=$1",
      [appearance.id],
    );
    check(
      before.r.refund === before.high.refund && before.high.mileage_used === 0,
      "unlimited mileage refund uses time only",
    );
    const cancel = {
      type: "cancel_protection",
      id: appearance.id,
      request_id: randomUUID(),
      revision: 1,
      canceled_on: "2026-01-31",
      mileage: 3000000,
      reason: "Fictional cancellation",
      payee: "Fictional holder",
    };
    await cmd(cancel);
    await cmd(cancel);
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_protection_contracts where batch_id=$1 and status='active'",
          [batch.id],
        )
      ).n === 5,
      "cancellation remains product-specific",
    );
    await deny({
      ...batch,
      id: randomUUID(),
      request_id: randomUUID(),
      contracts: batch.contracts.map((x) => ({ ...x, id: randomUUID() })),
    });
    const invalidStandalone = async (patch) =>
      deny({
        type: "issue_protection",
        id: randomUUID(),
        request_id: randomUUID(),
        contract: {
          ...batch.contracts[4].contract,
          opportunity_id: null,
          quote_id: null,
          product_id: null,
          ...patch,
        },
      });
    await invalidStandalone({ term_months: 95 });
    await invalidStandalone({ term_miles: 24000 });
    await invalidStandalone({ deductible: 250 });
    await invalidStandalone({ claim_limit: 10000 });
    const sales = await one(
      "select user_id from dmcrm_members where org_id=$1 and role='sales' and active limit 1",
      [org],
    );
    if (sales)
      await reject(commandSql, [
        org,
        sales.user_id,
        JSON.stringify({
          ...batch,
          id: randomUUID(),
          request_id: randomUUID(),
        }),
      ]);
  } finally {
    await client.query("rollback to savepoint protection_packet_verification");
    await client.query("release savepoint protection_packet_verification");
  }
}
