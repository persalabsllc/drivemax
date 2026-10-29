import { randomUUID } from "node:crypto";
// Metadata-only fixtures. No real images, messages or customers are retained.
export async function verifyCustomerLicenses(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, step) => {
    if (!ok)
      throw Object.assign(Error(`Customer licenses: ${step}`), {
        code: "LICENSE_VERIFY_FAILED",
      });
  };
  const rejects = async (sql, args) => {
    await client.query("savepoint license_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint license_reject");
    check(denied, "invalid or unauthorized write accepted");
  };
  await client.query("savepoint customer_license_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "owner");
    const cid = randomUUID(),
      target = randomUUID(),
      id = randomUUID(),
      hash = "a".repeat(64),
      crop = { x: 0.1, y: 0.2, width: 0.2, height: 0.35 };
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'License verification source',$3),($4,$2,'License verification target',$3)",
      [cid, org, owner.id, target],
    );
    const args = [
      org,
      owner.user_id,
      cid,
      id,
      1234,
      hash,
      JSON.stringify(crop),
    ];
    const save = "select dmcrm_save_license($1,$2,$3,$4,$5,$6,$7::jsonb) id";
    check((await one(save, args)).id === id, "save");
    check((await one(save, args)).id === id, "retry");
    check(
      Number(
        (await one("select count(*) n from dmcrm_deal_files where id=$1", [id]))
          .n,
      ) === 1,
      "duplicate file",
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from dmcrm_activities where customer_id=$1 and body like 'Driver license image saved%'",
            [cid],
          )
        ).n,
      ) === 1,
      "duplicate activity",
    );
    const before = await one("select * from dmcrm_deal_files where id=$1", [
      id,
    ]);
    check(
      before.kind === "identification" &&
        before.license_capture &&
        before.path === `${org}/licenses/${id}.jpg` &&
        before.retain_until,
      "private archive metadata",
    );
    check(
      JSON.stringify(before.license_portrait) === JSON.stringify(crop),
      "portrait",
    );
    await rejects(save, [
      org,
      owner.user_id,
      target,
      id,
      1234,
      hash,
      JSON.stringify(crop),
    ]);
    await rejects(save, [
      org,
      owner.user_id,
      cid,
      id,
      1234,
      "b".repeat(64),
      JSON.stringify(crop),
    ]);
    await rejects(save, [
      org,
      randomUUID(),
      cid,
      randomUUID(),
      1234,
      hash,
      JSON.stringify(crop),
    ]);
    await rejects(save, [
      randomUUID(),
      owner.user_id,
      cid,
      randomUUID(),
      1234,
      hash,
      JSON.stringify(crop),
    ]);
    await rejects(save, [
      org,
      owner.user_id,
      cid,
      randomUUID(),
      1234,
      hash,
      JSON.stringify({ ...crop, x: 0.95 }),
    ]);
    await rejects(
      "update dmcrm_deal_files set license_portrait=$2::jsonb where id=$1",
      [id, JSON.stringify({ ...crop, x: 0.2 })],
    );
    const sales = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='sales' limit 1",
      [org],
    );
    if (sales) {
      check(
        !(
          await one("select dmcrm_license_access($1,$2,$3) allowed", [
            org,
            sales.user_id,
            cid,
          ])
        ).allowed,
        "unassigned staff",
      );
      await client.query(
        "update dmcrm_customers set assigned_to=$2 where id=$1",
        [cid, sales.id],
      );
      check(
        (
          await one("select dmcrm_license_access($1,$2,$3) allowed", [
            org,
            sales.user_id,
            cid,
          ])
        ).allowed,
        "assigned staff",
      );
      const oid = randomUUID();
      await client.query(
        "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,co_buyer_id) values($1,$2,$3,$4,$5)",
        [oid, org, cid, sales.id, target],
      );
      await client.query(
        "update dmcrm_opportunities set co_buyer_id=$2 where id=$1",
        [oid, target],
      );
      check(
        (
          await one("select dmcrm_license_access($1,$2,$3) allowed", [
            org,
            sales.user_id,
            target,
          ])
        ).allowed,
        "deal co-buyer",
      );
      await client.query(
        "update dmcrm_opportunities set co_buyer_id=null,co_buyer=null where id=$1",
        [oid],
      );
    }
    const source = await one(
      "select updated_at from dmcrm_customers where id=$1",
      [cid],
    );
    const dest = await one(
      "select updated_at from dmcrm_customers where id=$1",
      [target],
    );
    await client.query("select dmcrm_command($1,$2,$3::jsonb)", [
      org,
      owner.user_id,
      JSON.stringify({
        type: "merge_customers",
        source_id: cid,
        target_id: target,
        source_updated_at: source.updated_at,
        target_updated_at: dest.updated_at,
        details_from: "target",
        confirmed: true,
      }),
    ]);
    const after = await one("select * from dmcrm_deal_files where id=$1", [id]);
    check(
      after.customer_id === target &&
        after.sha256 === before.sha256 &&
        after.path === before.path &&
        JSON.stringify(after.license_portrait) ===
          JSON.stringify(before.license_portrait),
      "merge preservation",
    );
    check(
      !(
        await one("select dmcrm_license_access($1,$2,$3) allowed", [
          org,
          owner.user_id,
          cid,
        ])
      ).allowed,
      "merged source rejected",
    );
    const privileges = await one(
      "select has_function_privilege('authenticated','public.dmcrm_save_license(uuid,uuid,uuid,uuid,integer,text,jsonb)','execute') allowed",
    );
    check(!privileges.allowed, "service-only RPC");
  } finally {
    await client.query("rollback to savepoint customer_license_verification");
  }
}
