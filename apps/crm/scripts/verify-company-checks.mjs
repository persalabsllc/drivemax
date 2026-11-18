import { randomUUID } from "node:crypto";

// This verifier must run inside a transaction; every fixture is rolled back.
export async function verifyCompanyChecks(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, values = []) => (await client.query(sql, values)).rows[0];
  const assert = (condition, name) => { if (!condition) throw Error("Company checks: " + name); };
  const owner = await one("select m.user_id from dmcrm_members m join dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=$1 and m.active and s.active and m.role='owner' and s.role='owner' limit 1", [org]);
  assert(owner, "owner exists");
  const cmd = async (data, actor = owner.user_id, organization = org) => (await one("select dmcrm_check_command($1,$2,$3::jsonb) value", [organization, actor, JSON.stringify(data)])).value;
  const rejects = async (fn, expected) => {
    await client.query("savepoint check_reject");
    let message = "";
    try { await fn(); } catch (e) { message = e.message; }
    await client.query("rollback to savepoint check_reject");
    assert(message.includes(expected), "rejects " + expected + (message ? " (" + message + ")" : ""));
  };
  await client.query("savepoint company_checks_verification");
  try {
    for (const table of ["dmcrm_check_accounts", "dmcrm_checks", "dmcrm_check_events"]) {
      const row = await one("select has_table_privilege('anon',$1,'select') anon,has_table_privilege('authenticated',$1,'select,insert,update,delete') browser,(select relrowsecurity from pg_class where oid=$1::regclass) rls", [table]);
      assert(!row.anon && !row.browser && row.rls, "private " + table);
    }
    const grants = await one("select has_function_privilege('authenticated','dmcrm_check_command(uuid,uuid,jsonb)','execute') browser,has_function_privilege('service_role','dmcrm_check_command(uuid,uuid,jsonb)','execute') server");
    assert(!grants.browser && grants.server, "commands are server only");
    const layout = { x: 0, y: 0, fields: Object.fromEntries(["date", "payee", "amount", "words", "address", "memo"].map((f) => [f, { x: 0, y: 0 }])) };
    const setup = { action: "save_account", id: randomUUID(), name: "Fictional verification account", last4: "0000", next_number: 7001, revision: 0, layout };
    await rejects(() => cmd(setup, randomUUID()), "check_owner_required");
    await rejects(() => cmd(setup, owner.user_id, randomUUID()), "check_owner_required");
    for (const role of ["manager", "finance", "sales"]) {
      await client.query("savepoint check_role");
      await client.query("update dmcrm_members set role=$1 where org_id=$2 and user_id=$3", [role, org, owner.user_id]);
      await rejects(() => cmd(setup), "check_owner_required");
      await client.query("rollback to savepoint check_role");
    }
    const account = await cmd(setup);
    const create = { action: "create", id: randomUUID(), account_id: account.id, check_number: 7001, details: { payee: "Fictional Payee", amount_cents: 123456, check_date: "2026-11-18", address: "", memo: "Rolled-back test" } };
    let c = await cmd(create);
    assert(c.amount_cents === 123456 && c.status === "prepared", "exact cents and unprinted status");
    assert((await cmd(create)).id === c.id, "lost-response retries do not reserve twice");
    await rejects(() => cmd({ ...create, details: { ...create.details, amount_cents: 99 } }), "check_retry_conflict");
    await rejects(() => cmd({ ...create, id: randomUUID() }), "check_number_changed");
    await rejects(() => cmd({ action: "mark_printed", id: c.id, revision: c.revision }), "check_pdf_required");
    await rejects(() => cmd({ ...setup, revision: 1 }), "check_stale");
    await rejects(() => cmd({ ...setup, revision: 2 }), "check_number_used");
    await cmd({ ...setup, name: "Renamed verification account", next_number: 7010, revision: 2 });
    assert((await one("select account_name from dmcrm_checks where id=$1", [c.id])).account_name === setup.name, "saved payment preserves account snapshot");
    const pdf = { action: "pdf", id: c.id, revision: c.revision, stock_confirmed: true, reason: "" };
    c = await cmd(pdf);
    assert(c.pdf_count === 1 && c.status === "prepared", "PDF creation never claims physical printing");
    await rejects(() => cmd(pdf), "check_stale");
    await rejects(() => cmd({ ...pdf, revision: c.revision }), "check_reprint_reason");
    c = await cmd({ ...pdf, revision: c.revision, reason: "Canceled print dialog; original not issued" });
    c = await cmd({ action: "mark_printed", id: c.id, revision: c.revision });
    assert(c.status === "printed" && c.printed_at, "explicit print confirmation");
    c = await cmd({ action: "void", id: c.id, revision: c.revision, reason: "Spoiled verification sheet" });
    assert(c.status === "voided" && c.void_reason, "void retains payment details and reason");
    await rejects(() => cmd({ ...pdf, revision: c.revision, reason: "Cannot print voided" }), "check_voided");
    await rejects(() => cmd({ ...setup, revision: 3 }), "check_number_used");
    assert(Number((await one("select count(*) n from dmcrm_check_events where check_id=$1", [c.id])).n) === 5, "creation, copies, print and void are audited");
    await rejects(() => cmd({ ...create, id: randomUUID(), check_number: 7010, details: { ...create.details, amount_cents: 0 } }), "amount_cents");
    assert((await one("select next_number from dmcrm_check_accounts where id=$1", [account.id])).next_number === 7010, "failed writes do not consume a number");
  } finally { await client.query("rollback to savepoint company_checks_verification"); }
}
