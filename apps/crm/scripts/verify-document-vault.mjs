import { randomUUID } from "node:crypto";
// Only metadata fixtures: no customer files are read, uploaded, or deleted.
// Every row and side effect is rolled back before the migration commits.
export async function verifyDocumentVault(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001",
    cid = randomUUID(),
    oid = randomUUID(),
    vid = randomUUID(),
    id = randomUUID(),
    vin = "VAULT" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (value) => {
    if (!value)
      throw Object.assign(Error("Document vault verification failed"), {
        code: "VAULT_VERIFY_FAILED",
      });
  };
  await client.query("savepoint document_vault_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and m.active and s.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id);
    await client.query(
      "insert into public.dmcrm_customers(id,org_id,name) values($1,$2,'Vault verification')",
      [cid, org],
    );
    await client.query(
      "insert into public.dmcrm_inventory(id,org_id,vin,stock_number,year,make,model,mileage,cost,price,acquired_on) values($1,$2,$4,$3,2017,'Toyota','Highlander',120000,8000,10000,current_date)",
      [vid, org, `VAULT-${id}`, vin],
    );
    await client.query(
      "insert into public.dmcrm_opportunities(id,org_id,customer_id,inventory_id,assigned_to) values($1,$2,$3,$4,$5)",
      [oid, org, cid, vid, owner.id],
    );
    await client.query(
      "insert into public.dmcrm_document_uploads(id,org_id,created_by,customer_id,opportunity_id,name,kind,size,mime,path,document_date) values($1,$2,$3,$4,$5,'Verification.pdf','signed',100,'application/pdf',$6,current_date)",
      [id, org, owner.user_id, cid, oid, `${org}/vault/${id}.pdf`],
    );
    const finish = () =>
      one("select public.dmcrm_complete_document($1,$2,$3,$4) id", [
        org,
        owner.user_id,
        id,
        "a".repeat(64),
      ]);
    check((await finish()).id === id);
    check((await finish()).id === id);
    const file = await one(
      "select *,retain_until::text retention from public.dmcrm_deal_files where id=$1",
      [id],
    );
    check(
      file.customer_name === "Vault verification" &&
        file.stock_number === `VAULT-${id}` &&
        file.vin === vin &&
        file.inventory_id === vid,
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_activities where opportunity_id=$1 and body like 'Document filed%'",
            [oid],
          )
        ).n,
      ) === 1,
    );
    await client.query(
      "update public.dmcrm_inventory set stock_number=$2 where id=$1",
      [vid, `EDITED-${id}`],
    );
    check(
      (
        await one(
          "select stock_number from public.dmcrm_deal_files where id=$1",
          [id],
        )
      ).stock_number === `VAULT-${id}`,
    );
    await client.query("savepoint retained_document_check");
    let blocked = false;
    try {
      await client.query("delete from public.dmcrm_deal_files where id=$1", [
        id,
      ]);
    } catch {
      blocked = true;
    }
    await client.query("rollback to savepoint retained_document_check");
    check(blocked);
    const bucket = await one(
      "select public,file_size_limit from storage.buckets where id='dmcrm-deal-files'",
    );
    check(
      bucket.public === false && Number(bucket.file_size_limit) === 26214400,
    );
    check(
      (
        await one(
          "select has_function_privilege('anon','public.dmcrm_complete_document(uuid,uuid,uuid,text)','execute') allowed",
        )
      ).allowed === false,
    );
  } finally {
    await client.query("rollback to savepoint document_vault_verification");
    await client.query("release savepoint document_vault_verification");
  }
}
