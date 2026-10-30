import { randomUUID } from "node:crypto";

// This verification runs inside the release transaction. Every fixture is rolled back.
export async function verifyManagementService(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, detail) => {
    if (!ok)
      throw Object.assign(Error(`Management/service: ${detail}`), {
        code: "MANAGEMENT_VERIFY_FAILED",
      });
  };
  const reject = async (sql, args = []) => {
    await client.query("savepoint management_reject");
    let denied = false;
    try {
      await client.query(sql, args);
    } catch {
      denied = true;
    }
    await client.query("rollback to savepoint management_reject");
    check(denied, "invalid write accepted");
  };
  await client.query("savepoint management_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and m.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "active owner");
    const commandSql = "select dmcrm_command($1,$2,$3::jsonb) id";
    const cmd = (p) => one(commandSql, [org, owner.user_id, JSON.stringify(p)]);
    const deny = (p) =>
      reject(commandSql, [org, owner.user_id, JSON.stringify(p)]);
    const cid = randomUUID(),
      oid = randomUUID(),
      iid = randomUUID(),
      id = randomUUID();
    const today = (
      await one(
        "select (now() at time zone 'America/New_York')::date::text today",
      )
    ).today;
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Service verification',$3)",
      [cid, org, owner.id],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to) values($1,$2,$3,$4)",
      [oid, org, cid, owner.id],
    );
    await client.query(
      "insert into dmcrm_inventory(id,org_id,stock_number,year,make,model,acquired_on,cost,recon,price,status,vin,mileage) values($1,$2,$3,2024,'Test','Vehicle',$4,1000,75,2500,'in_stock',$5,10000)",
      [
        iid,
        org,
        `VERIFY-${iid.slice(0, 8)}`,
        today,
        iid.replaceAll("-", "").slice(0, 17).toUpperCase(),
      ],
    );
    const order = {
      kind: "customer_pay",
      customer_id: cid,
      opportunity_id: oid,
      inventory_id: iid,
      vehicle: "Verification vehicle",
      vin: "",
      stock_number: "",
      mileage: 10000,
      assigned_to: owner.id,
      vendor: "Verification shop",
      due_on: today,
      concern: "Replace brake pads",
      findings: "",
      internal_notes: "Internal test cost",
      tax: 12.34,
      items: [
        {
          id: randomUUID(),
          kind: "labor",
          description: "Brake labor",
          quantity: 1.5,
          estimated_cost: 60.1,
          actual_cost: null,
          price: 100.1,
        },
      ],
    };
    const save = {
      type: "save_service_order",
      request_id: randomUUID(),
      id,
      revision: 0,
      order,
    };
    await reject(commandSql, [org, randomUUID(), JSON.stringify(save)]);
    const salesperson = await one(
      "select user_id from dmcrm_members where org_id=$1 and role='sales' and active limit 1",
      [org],
    );
    if (salesperson)
      await reject(commandSql, [
        org,
        salesperson.user_id,
        JSON.stringify(save),
      ]);
    await deny({
      ...save,
      request_id: randomUUID(),
      order: { ...order, customer_id: randomUUID() },
    });
    await deny({
      ...save,
      request_id: randomUUID(),
      order: { ...order, items: [{ ...order.items[0], quantity: 0.001 }] },
    });
    await cmd(save);
    await cmd(save);
    const getOrder = () =>
      one("select * from dmcrm_service_orders where id=$1", [id]);
    check((await getOrder()).revision === 1, "create retries are idempotent");
    await deny({ ...save, request_id: randomUUID() });
    await deny({
      type: "set_service_status",
      request_id: randomUUID(),
      id,
      revision: 1,
      status: "in_progress",
      reason: "",
    });
    await cmd({
      type: "authorize_service_order",
      request_id: randomUUID(),
      id,
      revision: 1,
      by: "Customer",
      method: "written",
      limit: 162.49,
      notes: "Approved estimate",
    });
    await deny({
      type: "set_service_status",
      request_id: randomUUID(),
      id,
      revision: 2,
      status: "completed",
      reason: "",
    });
    await cmd({
      ...save,
      request_id: randomUUID(),
      revision: 2,
      order: { ...order, items: [{ ...order.items[0], actual_cost: 60.1 }] },
    });
    check(
      (await getOrder()).authorization !== null,
      "actual cost preserves approval",
    );
    await cmd({
      ...save,
      request_id: randomUUID(),
      revision: 3,
      order: {
        ...order,
        concern: "Changed agreed work",
        items: [{ ...order.items[0], actual_cost: 60.1 }],
      },
    });
    check(
      (await getOrder()).authorization === null &&
        (await getOrder()).status === "awaiting_approval",
      "scope change invalidates approval",
    );
    await cmd({
      type: "authorize_service_order",
      request_id: randomUUID(),
      id,
      revision: 4,
      by: "Customer",
      method: "written",
      limit: 162.49,
      notes: "Reapproved",
    });
    await cmd({
      type: "set_service_status",
      request_id: randomUUID(),
      id,
      revision: 5,
      status: "completed",
      reason: "",
    });
    await deny({ ...save, request_id: randomUUID(), revision: 6 });
    const receipt = {
      type: "record_service_receipt",
      request_id: randomUUID(),
      receipt_id: randomUUID(),
      id,
      revision: 6,
      amount: 162.49,
      received_on: today,
      method: "Card",
      reference: "Test receipt",
      notes: "",
    };
    await deny({
      ...receipt,
      request_id: randomUUID(),
      received_on: "2999-01-01",
    });
    await cmd(receipt);
    await cmd(receipt);
    check(
      Number(
        (
          await one(
            "select sum(amount) n from dmcrm_service_receipts where order_id=$1",
            [id],
          )
        ).n,
      ) === 162.49,
      "exact cents and single receipt",
    );
    await cmd({
      type: "reverse_service_receipt",
      request_id: randomUUID(),
      receipt_id: randomUUID(),
      original_id: receipt.receipt_id,
      id,
      revision: 7,
      received_on: today,
      reason: "Correction",
    });
    await deny({
      type: "reverse_service_receipt",
      request_id: randomUUID(),
      receipt_id: randomUUID(),
      original_id: receipt.receipt_id,
      id,
      revision: 8,
      received_on: today,
      reason: "Correction",
    });
    await reject("update dmcrm_service_receipts set amount=1 where id=$1", [
      receipt.receipt_id,
    ]);
    check(
      Number(
        (
          await one(
            "select sum(case when reversal_of is null then amount else -amount end) n from dmcrm_service_receipts where order_id=$1",
            [id],
          )
        ).n,
      ) === 0,
      "reversal preserves original receipt",
    );

    const reconId = randomUUID(),
      recon = {
        ...order,
        kind: "reconditioning",
        customer_id: null,
        opportunity_id: null,
        tax: 0,
        items: [
          { ...order.items[0], estimated_cost: 50, actual_cost: 60, price: 0 },
        ],
      };
    await cmd({ ...save, id: reconId, request_id: randomUUID(), order: recon });
    await cmd({
      type: "authorize_service_order",
      request_id: randomUUID(),
      id: reconId,
      revision: 1,
      by: "Manager",
      method: "internal",
      limit: 90,
      notes: "",
    });
    await cmd({
      type: "set_service_status",
      request_id: randomUUID(),
      id: reconId,
      revision: 2,
      status: "completed",
      reason: "",
    });
    const before = await one(
      "select recon,updated_at::text stamp from dmcrm_inventory where id=$1",
      [iid],
    );
    check(
      Number(before.recon) === 75,
      "repair costs do not silently overwrite inventory",
    );
    const apply = {
      type: "apply_service_recon",
      request_id: randomUUID(),
      inventory_id: iid,
      expected_updated_at: before.stamp,
      other_costs: 25,
    };
    await cmd(apply);
    await cmd(apply);
    check(
      Number(
        (await one("select recon from dmcrm_inventory where id=$1", [iid]))
          .recon,
      ) === 115,
      "recon replaces rather than double counts",
    );
    await client.query("update dmcrm_inventory set status='sold' where id=$1", [
      iid,
    ]);
    await deny({ ...apply, request_id: randomUUID() });

    const reportId = randomUUID(),
      report = {
        type: "save_management_report",
        request_id: randomUUID(),
        id: reportId,
        revision: 0,
        name: "Verification dashboard",
        definition: {
          kind: "service",
          period: "month_to_date",
          from: null,
          to: null,
          staff_id: null,
          source: "",
          min_age: 45,
          no_appointments: false,
          overdue_only: false,
          metrics: ["sold", "gross", "repairs"],
          unit_target: 10,
          gross_target: null,
        },
        schedule: {
          frequency: "daily",
          hour: 8,
          minute: 0,
          weekday: 1,
          month_day: 1,
        },
        archived: false,
      };
    await deny({
      ...report,
      request_id: randomUUID(),
      schedule: { ...report.schedule, hour: 25 },
    });
    await deny({
      ...report,
      request_id: randomUUID(),
      definition: {
        ...report.definition,
        period: "custom",
        from: "2026-10-31",
        to: "2026-10-01",
      },
    });
    await cmd(report);
    await cmd(report);
    check(
      (
        await one("select revision from dmcrm_saved_reports where id=$1", [
          reportId,
        ])
      ).revision === 1,
      "saved report idempotency",
    );
    const summer = await one(
      "select dmcrm_report_next_run($1::jsonb,'2026-03-07T14:00:00Z')::text v",
      [JSON.stringify(report.schedule)],
    );
    check(
      new Date(summer.v).toISOString() === "2026-03-08T12:00:00.000Z",
      "DST forward at Eastern business time",
    );
    const winter = await one(
      "select dmcrm_report_next_run($1::jsonb,'2026-10-31T14:00:00Z')::text v",
      [JSON.stringify(report.schedule)],
    );
    check(
      new Date(winter.v).toISOString() === "2026-11-01T13:00:00.000Z",
      "DST backward at Eastern business time",
    );
    // Isolate worker checks from existing schedules; these changes roll back with the fixtures.
    await client.query(
      "update dmcrm_saved_reports set archived=true where id<>$1",
      [reportId],
    );
    await client.query(
      "update dmcrm_saved_reports set next_run_at=now()-interval '1 minute' where id=$1",
      [reportId],
    );
    const claimed = await client.query(
      "select * from dmcrm_claim_reports($1)",
      [org],
    );
    check(
      claimed.rows.length === 1 && claimed.rows[0].trigger === "scheduled",
      "due schedule claimed once",
    );
    const job = claimed.rows[0];
    check(
      (await client.query("select * from dmcrm_claim_reports($1)", [org])).rows
        .length === 0,
      "active leases prevent duplicate work",
    );
    check(
      !(
        await one("select dmcrm_finish_report($1,$2,$3::jsonb) ok", [
          job.id,
          randomUUID(),
          JSON.stringify({ version: 1, rows: [] }),
        ])
      ).ok,
      "wrong lease cannot complete",
    );
    check(
      (
        await one("select dmcrm_finish_report($1,$2,$3::jsonb) ok", [
          job.id,
          job.lease_id,
          JSON.stringify({ version: 1, title: "Original", rows: [] }),
        ])
      ).ok,
      "worker snapshot committed",
    );
    const pendingId = randomUUID();
    await cmd({
      type: "queue_management_report",
      request_id: randomUUID(),
      id: reportId,
      revision: 1,
      run_id: pendingId,
    });
    const pending = (
      await client.query("select * from dmcrm_claim_reports($1)", [org])
    ).rows[0];
    await cmd({
      ...report,
      request_id: randomUUID(),
      revision: 1,
      name: "Changed definition",
    });
    check(
      !(
        await one("select dmcrm_finish_report($1,$2,$3::jsonb) ok", [
          pending.id,
          pending.lease_id,
          JSON.stringify({ version: 1, rows: [] }),
        ])
      ).ok,
      "edited report cancels in-flight snapshot",
    );
    check(
      (
        await one("select snapshot from dmcrm_report_runs where id=$1", [
          job.id,
        ])
      ).snapshot.title === "Original",
      "finished snapshot survives editing",
    );
    const retryJob = randomUUID();
    await cmd({
      type: "queue_management_report",
      request_id: randomUUID(),
      id: reportId,
      revision: 2,
      run_id: retryJob,
    });
    await client.query("select * from dmcrm_claim_reports($1)", [org]);
    await client.query(
      "update dmcrm_report_runs set attempts=3,leased_at=now()-interval '6 minutes' where id=$1",
      [retryJob],
    );
    await client.query("select * from dmcrm_claim_reports($1)", [org]);
    check(
      (await one("select state from dmcrm_report_runs where id=$1", [retryJob]))
        .state === "failed",
      "exhausted leases do not leave reports generating forever",
    );
    const disabledJob = randomUUID();
    await cmd({
      type: "queue_management_report",
      request_id: randomUUID(),
      id: reportId,
      revision: 2,
      run_id: disabledJob,
    });
    await client.query(
      "update dmcrm_members set active=false where org_id=$1 and user_id=$2",
      [org, owner.user_id],
    );
    check(
      (await client.query("select * from dmcrm_claim_reports($1)", [org])).rows
        .length === 0,
      "disabled managers cannot generate reports",
    );
    check(
      (
        await one("select state from dmcrm_report_runs where id=$1", [
          disabledJob,
        ])
      ).state === "canceled",
      "lost access cancels queued runs",
    );
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set local role ${role}`);
      await reject("select * from public.dmcrm_service_orders");
      await reject("select * from public.dmcrm_report_runs");
      await reject("select * from public.dmcrm_claim_reports(null)");
      await client.query("reset role");
    }
  } finally {
    await client.query("rollback to savepoint management_verification");
    await client.query("release savepoint management_verification");
  }
}
