import { randomUUID } from "node:crypto";
const org = "d5a1c100-0000-4000-8000-000000000001";
export async function verifyWorkflows(client) {
  const one = async (sql, values = []) =>
    (await client.query(sql, values)).rows[0];
  const assert = (ok) => {
    if (!ok)
      throw Object.assign(Error("Workflow verification failed"), {
        code: "WORKFLOW_VERIFY_FAILED",
      });
  };
  const cid = randomUUID(),
    oid = randomUUID(),
    aid = randomUUID();
  await client.query("savepoint workflow_verification");
  try {
    const staff = await one(
      "select s.id,s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' limit 1",
      [org],
    );
    assert(staff?.id);
    await client.query(
      "insert into public.dmcrm_customers(id,org_id,name,email,source,assigned_to) values($1,$2,'Workflow verification',$3,'Internal verification',$4)",
      [cid, org, `verify-${cid}@example.invalid`, staff.id],
    );
    await client.query(
      "insert into public.dmcrm_opportunities(id,org_id,customer_id,assigned_to) values($1,$2,$3,$4)",
      [oid, org, cid, staff.id],
    );
    await client.query(
      "insert into public.dmcrm_appointments(id,org_id,customer_id,opportunity_id,assigned_to,kind,starts_at,duration_minutes,created_by) values($1,$2,$3,$4,$5,'test_drive',now()+interval '7 days',30,$6)",
      [aid, org, cid, oid, staff.id, staff.user_id],
    );
    await client.query("select public.dmcrm_workflow_prepare()");
    const first = await one(
      "select message_id from public.dmcrm_workflow_jobs where appointment_id=$1 and event='appointment_created'",
      [aid],
    );
    // Respect a manager disabling this step on later releases.
    if (first?.message_id) {
      const claim = await one("select * from public.dmcrm_email_claim($1)", [
        first.message_id,
      ]);
      assert(claim?.recipient === `verify-${cid}@example.invalid`);
      assert(
        !(await one("select * from public.dmcrm_email_claim($1)", [
          first.message_id,
        ])),
      );
      await client.query(
        "select public.dmcrm_email_finish($1,$2,'sent',$3,null)",
        [first.message_id, claim.claim_token, `verify-${randomUUID()}`],
      );
    }
    await client.query(
      "update public.dmcrm_appointments set starts_at=starts_at+interval '1 day',revision=revision+1 where id=$1",
      [aid],
    );
    await client.query("select public.dmcrm_workflow_prepare()");
    assert(
      (
        await one(
          "select count(*)::int n from public.dmcrm_workflow_jobs where appointment_id=$1 and event like 'reminder%' and state='scheduled' and (context->>'starts_at')::timestamptz<>(select starts_at from public.dmcrm_appointments where id=$1)",
          [aid],
        )
      ).n === 0,
    );
    await client.query(
      "update public.dmcrm_appointments set status='no_show',revision=revision+1 where id=$1",
      [aid],
    );
    await client.query("select public.dmcrm_workflow_prepare()");
    assert(
      (
        await one(
          "select count(*)::int n from public.dmcrm_workflow_jobs where appointment_id=$1 and event like 'reminder%' and state='scheduled'",
          [aid],
        )
      ).n === 0,
    );
    const link = await one(
      "select token from public.dmcrm_appointment_links where appointment_id=$1",
      [aid],
    );
    assert(link?.token);
    const result = await one(
      "select public.dmcrm_public_appointment($1,'request','Internal verification only') result",
      [link.token],
    );
    assert(result.result.request_received);
    assert(
      (
        await one(
          "select count(*)::int n from public.dmcrm_tasks where customer_id=$1 and title='Customer requested an appointment change'",
          [cid],
        )
      ).n === 1,
    );
  } finally {
    await client.query("rollback to savepoint workflow_verification");
    await client.query("release savepoint workflow_verification");
  }
  assert(
    !(await one("select id from public.dmcrm_customers where id=$1", [cid])),
  );
}
