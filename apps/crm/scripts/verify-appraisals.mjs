import { randomUUID } from "node:crypto";
const org = "d5a1c100-0000-4000-8000-000000000001";
// Runs inside the migration transaction and rolls back every fixture, including
// activity/audit rows. No messages, customers or financial changes are retained.
export async function verifyAppraisals(client) {
  const one = async (sql, values = []) =>
    (await client.query(sql, values)).rows[0];
  const assert = (ok) => {
    if (!ok)
      throw Object.assign(Error("Appraisal verification failed"), {
        code: "APPRAISAL_VERIFY_FAILED",
      });
  };
  const cid = randomUUID(),
    oid = randomUUID(),
    aid = randomUUID(),
    qid = randomUUID();
  await client.query("savepoint appraisal_verification");
  try {
    const staff = await one(
      "select s.id,s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' limit 1",
      [org],
    );
    assert(staff?.id);
    const trade = {
      vin: "2FMPK3K94KBC11561",
      year: 2019,
      make: "Ford",
      model: "Edge",
      trim: "Titanium",
      mileage: 132558,
      allowance: 5000,
      acv: 6500,
      payoff: 500,
      description: "Verification trade",
    };
    const data = {
      vehicle: {
        vin: trade.vin,
        year: trade.year,
        make: trade.make,
        model: trade.model,
        trim: trade.trim,
        mileage: trade.mileage,
      },
      description: "Verification only",
      zip: "28562",
      radius: 100,
      condition: "good",
      title: "unverified",
      inspection_notes: "",
      disposition: "retail",
      target_value: 11000,
      target_profit: 2000,
      proposed_acv: 6200,
      recon: [{ id: randomUUID(), label: "Tires", amount: 800 }],
      buyer_fee: 0,
      transport: 150,
      other_cost: 0,
      books: [],
      comparables: [],
      notes: "",
    };
    await client.query(
      "insert into public.dmcrm_customers(id,org_id,name) values($1,$2,'Appraisal verification')",
      [cid, org],
    );
    await client.query(
      "insert into public.dmcrm_opportunities(id,org_id,customer_id,assigned_to,trade,trade_vehicle) values($1,$2,$3,$4,$5::jsonb,'Verification trade')",
      [oid, org, cid, staff.id, JSON.stringify(trade)],
    );
    await client.query(
      "insert into public.dmcrm_quotes(id,org_id,customer_id,opportunity_id,vehicle,values) values($1,$2,$3,$4,'Verification vehicle',$5::jsonb)",
      [
        qid,
        org,
        cid,
        oid,
        JSON.stringify({
          price: 11000,
          acv: 6500,
          tradeAllowance: 5000,
          payoff: 500,
        }),
      ],
    );
    const command = async (p) =>
      one("select public.dmcrm_command($1,$2,$3::jsonb) id", [
        org,
        staff.user_id,
        JSON.stringify(p),
      ]);
    const before = await one(
      "select trade,updated_at::text updated_at from public.dmcrm_opportunities where id=$1",
      [oid],
    );
    await command({
      type: "save_appraisal",
      id: aid,
      revision: 0,
      opportunity_id: oid,
      source: "trade",
      status: "review",
      data,
    });
    await command({ type: "approve_appraisal", id: aid, revision: 1 });
    await command({
      type: "apply_appraisal",
      id: aid,
      revision: 2,
      opportunity_updated_at: before.updated_at,
    });
    const after = await one(
      "select trade from public.dmcrm_opportunities where id=$1",
      [oid],
    );
    assert(
      after.trade.acv === 6200 &&
        after.trade.allowance === 5000 &&
        after.trade.payoff === 500 &&
        after.trade.vin === trade.vin,
    );
    const quote = await one(
      "select values from public.dmcrm_quotes where id=$1",
      [qid],
    );
    assert(quote.values.acv === 6500 && quote.values.tradeAllowance === 5000);
    const a = await one("select * from public.dmcrm_appraisals where id=$1", [
      aid,
    ]);
    assert(
      a.status === "valued" &&
        a.revision === 3 &&
        a.applied_at &&
        a.reviewed_by === staff.id,
    );
    assert(
      (
        await one(
          "select count(*)::int n from public.dmcrm_appraisal_revisions where appraisal_id=$1",
          [aid],
        )
      ).n === 3,
    );
    assert(
      (
        await one(
          "select count(*)::int n from public.dmcrm_activities where opportunity_id=$1 and body like 'Appraisal ACV applied%'",
          [oid],
        )
      ).n === 1,
    );
    await command({
      type: "save_appraisal",
      id: aid,
      revision: 3,
      opportunity_id: oid,
      source: "trade",
      status: "draft",
      data: { ...data, proposed_acv: 6100 },
    });
    const edited = await one(
      "select * from public.dmcrm_appraisals where id=$1",
      [aid],
    );
    assert(
      edited.status === "draft" && !edited.reviewed_at && !edited.applied_at,
    );
    assert(
      (
        await one("select trade from public.dmcrm_opportunities where id=$1", [
          oid,
        ])
      ).trade.acv === 6200,
    );
  } finally {
    await client.query("rollback to savepoint appraisal_verification");
    await client.query("release savepoint appraisal_verification");
  }
  assert(
    !(await one("select id from public.dmcrm_customers where id=$1", [cid])),
  );
}
