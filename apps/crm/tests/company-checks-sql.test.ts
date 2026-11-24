import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verifyCompanyChecks } from "../scripts/verify-company-checks.mjs";
import { configureCompanyCheckBank } from "../scripts/configure-company-check-bank.mjs";

const org = "d5a1c100-0000-4000-8000-000000000001";
const owner = "d5a1c100-0000-4000-8000-000000000099";
const account = "d5a1c100-0000-4000-8000-000000000230";
const fakeConfig = JSON.stringify({ org_id: org, account_id: account, routing: "011000015", account: "123456789" });
const bankMigration = () => readFile(new URL("../db/046_company_check_bank_setup.sql", import.meta.url), "utf8");
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table dmcrm_orgs(id uuid primary key);
    create table dmcrm_members(org_id uuid,user_id uuid,active boolean,role text);
    create table dmcrm_staff(org_id uuid,user_id uuid,active boolean,role text);
    insert into dmcrm_orgs values('${org}');
    insert into dmcrm_members values('${org}','${owner}',true,'owner');
    insert into dmcrm_staff select * from dmcrm_members;`);
  await db.exec(await readFile(new URL("../db/044_company_checks.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../db/045_company_check_bottom_template.sql", import.meta.url), "utf8"));
  return db;
}

test("check ledger: owner isolation, retries, number reservation, revisions, print and void audit", async () => {
  const db = await fixture();
  try {
    await db.exec(await bankMigration());
    await configureCompanyCheckBank(db, fakeConfig);
    await db.exec("begin");
    await verifyCompanyChecks(db);
    await db.exec("rollback");
  } finally { await db.close(); }
});

test("bank setup preserves established numbering/alignment and only enables its designated account", async () => {
  const db = await fixture();
  try {
    const otherOrg = "d5a1c100-0000-4000-8000-000000000002";
    const otherAccount = "d5a1c100-0000-4000-8000-000000000231";
    await db.exec(`update dmcrm_check_accounts set name='Established account label',next_number=345,
      layout=jsonb_set(layout,'{fields,payee,x}','2.5'::jsonb) where id='${account}';
      insert into dmcrm_orgs values('${otherOrg}');
      insert into dmcrm_members values('${otherOrg}','${owner}',true,'owner');
      insert into dmcrm_staff values('${otherOrg}','${owner}',true,'owner');
      insert into dmcrm_check_accounts(id,org_id,name,last4,next_number,layout)
        select '${otherAccount}','${otherOrg}','Other dealership','1111',500,layout from dmcrm_check_accounts where id='${account}';`);
    const before = (await db.query<{ name: string; next_number: number; revision: number; layout: unknown }>("select * from dmcrm_check_accounts where id=$1", [account])).rows[0];
    await db.exec(await bankMigration());
    await configureCompanyCheckBank(db, fakeConfig);
    const after = (await db.query<{ bank_ready: boolean; last4: string; name: string; next_number: number; revision: number; layout: unknown }>("select * from dmcrm_check_accounts where id=$1", [account])).rows[0];
    assert.equal(after.bank_ready, true);
    assert.equal(after.last4, "6789");
    assert.equal(after.name, before.name);
    assert.equal(after.next_number, before.next_number);
    assert.deepEqual(after.layout, before.layout);
    assert.equal(after.revision, before.revision + 1);
    const other = (await db.query<{ bank_ready: boolean; last4: string; next_number: number }>("select * from dmcrm_check_accounts where id=$1", [otherAccount])).rows[0];
    assert.equal(other.bank_ready, false);
    assert.equal(other.last4, "1111");
    assert.equal(other.next_number, 500);
    const audit = (await db.query<{ details: { before: Record<string, unknown>; after: Record<string, unknown> } }>("select details from dmcrm_check_events where account_id=$1 and action='configure_bank'", [account])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].details.after.bank_ready, true);
    assert.equal(audit[0].details.after.last4, "6789");
    assert.equal(JSON.stringify(audit).includes("account_number"), false);
    assert.equal(JSON.stringify(audit).includes("routing_number"), false);
    await configureCompanyCheckBank(db, fakeConfig);
    assert.equal((await db.query<{ revision: number }>("select revision from dmcrm_check_accounts where id=$1", [account])).rows[0].revision, after.revision);
    assert.equal((await db.query("select * from dmcrm_check_events where account_id=$1 and action='configure_bank'", [account])).rows.length, 1);
    // An already configured account may select preprinted stock before issuing checks;
    // subsequent deployments must not override that choice or create duplicate audit rows.
    await db.query("update dmcrm_check_accounts set layout=jsonb_set(layout,'{stock}','\"preprinted_top\"'::jsonb) where id=$1", [account]);
    await configureCompanyCheckBank(db, fakeConfig);
    assert.equal((await db.query<{ revision: number }>("select revision from dmcrm_check_accounts where id=$1", [account])).rows[0].revision, after.revision);
    assert.equal((await db.query("select * from dmcrm_check_events where account_id=$1 and action='configure_bank'", [account])).rows.length, 1);
    const create = { action: "create", id: "d5a1c100-0000-4000-8000-000000000888", account_id: account, check_number: 345,
      details: { payee: "Fictional Payee", amount_cents: 100, check_date: "2026-11-23", memo: "", address: "" } };
    await assert.rejects(db.query("select dmcrm_check_command($1,$2,$3::jsonb)", [otherOrg, owner, JSON.stringify(create)]), /check_account_missing/);
    const save = { action: "save_account", id: account, revision: after.revision, name: after.name, last4: after.last4, next_number: after.next_number, layout: after.layout };
    await assert.rejects(db.query("select dmcrm_check_command($1,$2,$3::jsonb)", [otherOrg, owner, JSON.stringify(save)]), /check_account_missing/);
    assert.equal((await db.query("select * from dmcrm_checks")).rows.length, 0);
  } finally { await db.close(); }
});

test("bank setup refuses to change an account that already has checks", async () => {
  const db = await fixture();
  try {
    await db.exec(`insert into dmcrm_checks(id,org_id,account_id,account_name,account_last4,check_number,payee,amount_cents,check_date,created_by)
      values('d5a1c100-0000-4000-8000-000000000889','${org}','${account}','Existing account','1111',230,'Fictional Payee',100,'2026-11-23','${owner}');`);
    await db.exec(await bankMigration());
    await assert.rejects(configureCompanyCheckBank(db, fakeConfig), /check_bank_account_locked/);
  } finally { await db.close(); }
});


test("bank setup rejects invalid runtime values without exposing them and permits absent configuration", async () => {
  const client = { query() { throw new Error("Unexpected database query"); } };
  await configureCompanyCheckBank(client, undefined);
  for (const raw of ["invalid-secret-json", JSON.stringify({ ...JSON.parse(fakeConfig), routing: "123456789" }),
    JSON.stringify({ ...JSON.parse(fakeConfig), account: "not-bank-digits" }),
    JSON.stringify({ ...JSON.parse(fakeConfig), account_id: "not-a-uuid" })]) {
    await assert.rejects(configureCompanyCheckBank(client, raw), (error: unknown) => error instanceof Error
      && error.message === "Invalid company check banking configuration.");
  }
});
