import { randomUUID } from "node:crypto";
// Runs inside the migration transaction. No uploaded bytes or outbound messages;
// every sale, tag, document-metadata fixture and workflow side effect is rolled back.
export async function verifyTitleClerk(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001",
    cid = randomUUID(),
    oid = randomUUID(),
    tag = randomUUID(),
    file = randomUUID();
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (value) => {
    if (!value)
      throw Object.assign(Error("Title clerk verification failed"), {
        code: "TITLE_CLERK_VERIFY_FAILED",
      });
  };
  await client.query("savepoint title_clerk_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' limit 1",
      [org],
    );
    check(owner?.id);
    const cmd = (value) =>
      one("select public.dmcrm_command($1,$2,$3::jsonb) id", [
        org,
        owner.user_id,
        JSON.stringify(value),
      ]);
    const dates = await one(
      "select (now() at time zone 'America/New_York')::date::text today,((now() at time zone 'America/New_York')::date+60)::text expires",
    );
    await client.query(
      "insert into public.dmcrm_customers(id,org_id,name) values($1,$2,'Title clerk verification')",
      [cid, org],
    );
    await client.query(
      "insert into public.dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest) values($1,$2,$3,$4,'Verification vehicle')",
      [oid, org, cid, owner.id],
    );
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    const c = await one(
      "select * from public.dmcrm_title_cases where org_id=$1 and opportunity_id=$2",
      [org, oid],
    );
    check(
      c?.customer_name === "Title clerk verification" &&
        c.vehicle_label === "Verification vehicle" &&
        c.status === "sold",
    );
    const sale = await one(
      "select snapshot,accounting from public.dmcrm_sales where id=$1",
      [c.sale_id],
    );
    await cmd({
      type: "save_title_case",
      id: c.id,
      revision: c.revision,
      values: {
        status: "pending",
        checklist: { title_received: "done" },
        pending_reason: "Verification waiting item",
        notes: "Verification only",
        next_action_on: dates.today,
        ready_on: null,
        submitted_on: null,
        completed_on: null,
      },
    });
    check(
      (
        await one(
          "select status,revision from public.dmcrm_title_cases where id=$1",
          [c.id],
        )
      ).revision === 1,
    );
    await cmd({
      type: "save_temp_tag",
      id: tag,
      case_id: c.id,
      revision: 0,
      values: {
        number: `QA-${tag.slice(0, 8).toUpperCase()}`,
        issued_on: dates.today,
        expires_on: dates.expires,
        status: "active",
        closed_on: null,
        notes: "Verification only",
      },
    });
    await client.query(
      "insert into public.dmcrm_deal_files(id,org_id,customer_id,opportunity_id,name,kind,size,mime,path,created_by,sha256) values($1,$2,$3,$4,'Verification receipt.pdf','title',100,'application/pdf',$5,$6,$7)",
      [
        file,
        org,
        cid,
        oid,
        `${org}/verification/${file}.pdf`,
        owner.user_id,
        "a".repeat(64),
      ],
    );
    await cmd({
      type: "attach_title_document",
      id: c.id,
      file_id: file,
      purpose: "dmv_receipt",
    });
    await cmd({
      type: "attach_title_document",
      id: c.id,
      file_id: file,
      purpose: "dmv_receipt",
    });
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_title_documents where case_id=$1",
            [c.id],
          )
        ).n,
      ) === 1,
    );
    check(
      JSON.stringify(
        await one(
          "select snapshot,accounting from public.dmcrm_sales where id=$1",
          [c.sale_id],
        ),
      ) === JSON.stringify(sale),
    );
    const reviewedAmounts = {
      fees: 114,
      taxes: 146.97,
      note: "Verification only",
    };
    await cmd({
      type: "save_title_amounts",
      id: c.id,
      revision: 1,
      values: reviewedAmounts,
    });
    const reviewed = await one(
      "select amounts,revision from public.dmcrm_title_cases where id=$1",
      [c.id],
    );
    check(
      reviewed.amounts.fees === 114 &&
        reviewed.amounts.taxes === 146.97 &&
        reviewed.revision === 2,
    );
    check(
      JSON.stringify(
        await one(
          "select snapshot,accounting from public.dmcrm_sales where id=$1",
          [c.sale_id],
        ),
      ) === JSON.stringify(sale),
    );
    check(
      (
        await one(
          "select count(*)::int n from public.dmcrm_title_events where case_id=$1 and event='DMV amounts reviewed'",
          [c.id],
        )
      ).n === 1,
    );
    await cmd({
      type: "unwind_sale",
      opportunity_id: oid,
      reason: "Verification rollback",
    });
    check(
      (
        await one("select status from public.dmcrm_temp_tags where id=$1", [
          tag,
        ])
      ).status === "void",
    );
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    check(
      (
        await one(
          "select c.amounts from public.dmcrm_title_cases c join public.dmcrm_sales s on s.id=c.sale_id where c.opportunity_id=$1 and s.status='sold'",
          [oid],
        )
      ).amounts === null,
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_title_cases where opportunity_id=$1",
            [oid],
          )
        ).n,
      ) === 2,
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_title_documents where case_id=$1",
            [c.id],
          )
        ).n,
      ) === 1,
    );
  } finally {
    await client.query("rollback to savepoint title_clerk_verification");
    await client.query("release savepoint title_clerk_verification");
  }
}
