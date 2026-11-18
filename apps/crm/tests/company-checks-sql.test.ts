import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verifyCompanyChecks } from "../scripts/verify-company-checks.mjs";
test("check ledger: owner isolation, retries, number reservation, revisions, print and void audit", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table dmcrm_orgs(id uuid primary key);
      create table dmcrm_members(org_id uuid,user_id uuid,active boolean,role text);
      create table dmcrm_staff(org_id uuid,user_id uuid,active boolean,role text);
      insert into dmcrm_orgs values('d5a1c100-0000-4000-8000-000000000001');
      insert into dmcrm_members values('d5a1c100-0000-4000-8000-000000000001','d5a1c100-0000-4000-8000-000000000099',true,'owner');
      insert into dmcrm_staff select * from dmcrm_members;`);
    await db.exec(await readFile(new URL("../db/044_company_checks.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../db/045_company_check_bottom_template.sql", import.meta.url), "utf8"));
    await db.exec("begin");
    await verifyCompanyChecks(db);
    await db.exec("rollback");
  } finally { await db.close(); }
});
