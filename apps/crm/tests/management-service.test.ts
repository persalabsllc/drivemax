import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, defaultQuote, type Command } from "../lib/model";
import {
  defaultReport,
  defaultSchedule,
  buildManagementReport,
  nextReportRun,
  reportRange,
  reportDefinitionSchema,
  reportCsv,
} from "../lib/management-reports";
import {
  serviceBlank,
  serviceOrderSchema,
  serviceTotals,
  servicePaid,
  type ServiceOrder,
} from "../lib/service";
import { emptyAccounting, type Sale } from "../lib/operations";
const now = new Date("2026-10-30T16:00:00Z");

test("report periods compare calendar months correctly and reject reversed or excessive ranges", () => {
  assert.deepEqual(reportRange(defaultReport, "2026-03-31"), {
    from: "2026-03-01",
    to: "2026-03-31",
    previous_from: "2026-02-01",
    previous_to: "2026-02-28",
  });
  assert.deepEqual(
    reportRange({ ...defaultReport, period: "last_month" }, "2026-01-15"),
    {
      from: "2025-12-01",
      to: "2025-12-31",
      previous_from: "2025-11-01",
      previous_to: "2025-11-30",
    },
  );
  assert.deepEqual(
    reportRange(
      {
        ...defaultReport,
        period: "custom",
        from: "2026-10-10",
        to: "2026-10-12",
      },
      "2026-10-30",
    ),
    {
      from: "2026-10-10",
      to: "2026-10-12",
      previous_from: "2026-10-07",
      previous_to: "2026-10-09",
    },
  );
  assert.equal(
    reportDefinitionSchema.safeParse({
      ...defaultReport,
      period: "custom",
      from: "2026-10-30",
      to: "2026-10-01",
    }).success,
    false,
  );
  assert.equal(
    reportDefinitionSchema.safeParse({
      ...defaultReport,
      period: "custom",
      from: "2024-01-01",
      to: "2026-10-30",
    }).success,
    false,
  );
});
test("schedules respect Eastern DST, weekly/monthly boundaries, and late business hours", () => {
  assert.equal(
    nextReportRun(
      { ...defaultSchedule, frequency: "daily" },
      new Date("2026-03-07T14:00:00Z"),
    ),
    "2026-03-08T12:00:00.000Z",
  );
  assert.equal(
    nextReportRun(
      { ...defaultSchedule, frequency: "daily" },
      new Date("2026-10-31T14:00:00Z"),
    ),
    "2026-11-01T13:00:00.000Z",
  );
  assert.equal(
    nextReportRun({ ...defaultSchedule, frequency: "weekly", weekday: 1 }, now),
    "2026-11-02T13:00:00.000Z",
  );
  assert.equal(
    nextReportRun(
      { ...defaultSchedule, frequency: "monthly", month_day: 28 },
      now,
    ),
    "2026-11-28T13:00:00.000Z",
  );
  assert.equal(
    nextReportRun(
      { ...defaultSchedule, frequency: "daily", hour: 20, minute: 45 },
      new Date("2026-10-30T23:59:00Z"),
    ),
    "2026-10-31T00:45:00.000Z",
  );
  assert.equal(nextReportRun(defaultSchedule, now), null);
});
test("reports use sold snapshots, Eastern lead dates, reviewed costs, and exclude unwound sales", () => {
  const ws = demoWorkspace(now),
    customer = ws.customers[0],
    opportunity = {
      ...ws.opportunities[0],
      source: "Facebook",
      created_at: "2026-10-01T02:00:00Z",
    };
  ws.opportunities = [opportunity];
  const sale = {
    id: randomUUID(),
    org_id: ws.org.id,
    opportunity_id: opportunity.id,
    customer_id: customer.id,
    sold_on: "2026-10-20",
    created_at: now.toISOString(),
    status: "sold",
    snapshot: {
      customer,
      opportunity,
      quote: {
        ...ws.quotes[0],
        id: randomUUID(),
        vehicle: "Test",
        values: { ...defaultQuote, price: 10000, docFee: 0 },
      },
      salesperson: null,
    },
    accounting: { ...emptyAccounting, vehicle_cost: 7000, recon: 0 },
    revision: 0,
    unwound_at: null,
    unwind_reason: "",
  } as Sale;
  ws.sales = [
    sale,
    { ...sale, id: randomUUID(), sold_on: "2026-09-20" },
    { ...sale, id: randomUUID(), status: "unwound" },
    {
      ...sale,
      id: randomUUID(),
      accounting: { ...emptyAccounting, vehicle_cost: null },
    },
  ];
  const result = buildManagementReport(
    ws,
    {
      ...defaultReport,
      source: " facebook ",
      metrics: ["sold", "gross", "pvr", "leads"],
      unit_target: 10,
    },
    "Sales",
    now,
  );
  assert.deepEqual(
    result.metrics.map((m) => [m.key, m.value, m.previous]),
    [
      ["sold", 2, 1],
      ["gross", 3000, 3000],
      ["pvr", 3000, 3000],
      ["leads", 0, 1],
    ],
  );
  assert.equal(result.metrics[0].target, 10);
  assert.ok(result.notes.some((n) => n.includes("Incomplete deal costs: 1")));
  assert.equal(
    result.trend.reduce((n, t) => n + t.units, 0),
    2,
  );
  ws.sales = [
    { ...sale, accounting: { ...emptyAccounting, vehicle_cost: null } },
  ];
  assert.equal(
    buildManagementReport(ws, defaultReport, "Incomplete", now).metrics.find(
      (m) => m.key === "gross",
    )?.value,
    null,
  );
  assert.ok(
    reportCsv({ ...result, title: '=HYPERLINK("bad")' }).includes("'="),
  );
});
test("service estimates use line rounding, missing actuals remain unknown, and unrealistic totals are refused", () => {
  const ws = demoWorkspace(now),
    input = {
      ...serviceBlank(ws, ws.customers[0].id),
      vehicle: "Customer car",
      concern: "Replace pads",
      items: [
        {
          id: randomUUID(),
          kind: "labor" as const,
          description: "Labor",
          quantity: 1.5,
          estimated_cost: 60.1,
          actual_cost: null,
          price: 100.1,
        },
      ],
      tax: 12.34,
    };
  assert.deepEqual(serviceTotals(input), {
    estimate: 90.15,
    actual: null,
    subtotal: 150.15,
    total: 162.49,
  });
  assert.equal(
    serviceOrderSchema.safeParse({
      ...input,
      items: [{ ...input.items[0], quantity: 10000, price: 1000000 }],
    }).success,
    false,
  );
});
test("service demo preserves approvals for actual costs, invalidates scope changes, keeps receipts, and freezes completed work", () => {
  let ws = demoWorkspace(now);
  const id = randomUUID(),
    input = {
      ...serviceBlank(ws, ws.customers[0].id),
      kind: "customer_pay" as const,
      vehicle: "Customer car",
      concern: "Replace pads",
      items: [
        {
          id: randomUUID(),
          kind: "labor" as const,
          description: "Labor",
          quantity: 1,
          estimated_cost: 100,
          actual_cost: null,
          price: 150,
        },
      ],
      tax: 0,
    };
  const save: Command = {
    type: "save_service_order",
    id,
    request_id: randomUUID(),
    revision: 0,
    order: input,
  };
  ws = demoCommand(ws, save, now);
  assert.deepEqual(demoCommand(ws, save, now), ws);
  const act = (p: Command) => {
    ws = demoCommand(ws, p, now);
  };
  const base = () => ({
    id,
    request_id: randomUUID(),
    revision: ws.service_orders![0].revision,
  });
  assert.throws(
    () =>
      demoCommand(
        ws,
        {
          ...base(),
          type: "set_service_status",
          status: "completed",
          reason: "",
        },
        now,
      ),
    /authorization/,
  );
  act({
    ...base(),
    type: "authorize_service_order",
    by: "Customer",
    method: "phone",
    limit: 150,
    notes: "",
  });
  act({
    ...base(),
    type: "save_service_order",
    order: { ...input, items: [{ ...input.items[0], actual_cost: 90 }] },
  });
  assert.ok(ws.service_orders![0].authorization);
  act({
    ...base(),
    type: "save_service_order",
    order: {
      ...input,
      concern: "Different scope",
      items: [{ ...input.items[0], actual_cost: 90 }],
    },
  });
  assert.equal(ws.service_orders![0].authorization, null);
  act({
    ...base(),
    type: "authorize_service_order",
    by: "Customer",
    method: "written",
    limit: 150,
    notes: "",
  });
  act({
    ...base(),
    type: "set_service_status",
    status: "completed",
    reason: "",
  });
  assert.throws(
    () =>
      demoCommand(
        ws,
        { ...base(), type: "save_service_order", order: input },
        now,
      ),
    /cannot be edited/,
  );
  const receipt: Command = {
    ...base(),
    type: "record_service_receipt",
    receipt_id: randomUUID(),
    amount: 150,
    received_on: "2026-10-30",
    method: "Cash",
    reference: "",
    notes: "",
  };
  act(receipt);
  assert.equal(servicePaid(ws, id), 150);
  assert.deepEqual(demoCommand(ws, receipt, now), ws);
  act({
    ...base(),
    type: "reverse_service_receipt",
    receipt_id: randomUUID(),
    original_id: receipt.receipt_id,
    received_on: "2026-10-30",
    reason: "Correction",
  });
  assert.equal(servicePaid(ws, id), 0);
  assert.equal(ws.service_receipts!.length, 2);
  assert.throws(
    () =>
      demoCommand(
        { ...ws, member: { ...ws.member, role: "sales" } },
        {
          ...base(),
          type: "record_service_receipt",
          receipt_id: randomUUID(),
          amount: 1,
          received_on: "2026-10-30",
          method: "Cash",
          reference: "",
          notes: "",
        },
        now,
      ),
    /Manager/,
  );
});
test("saved snapshots remain unchanged after report or source edits and overdue We Owe excludes completed work", () => {
  let ws = demoWorkspace(now);
  const reportId = randomUUID();
  ws.service_orders = [
    {
      ...serviceBlank(ws, ws.customers[0].id),
      id: randomUUID(),
      org_id: ws.org.id,
      order_number: 1,
      customer_name: "Sample",
      vehicle: "Car",
      concern: "Spare key",
      status: "approved",
      due_on: "2026-10-29",
      revision: 1,
      authorization: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      completed_at: null,
      canceled_reason: "",
      created_by: ws.member.id,
    } as ServiceOrder,
  ];
  const save: Command = {
    type: "save_management_report",
    request_id: randomUUID(),
    id: reportId,
    revision: 0,
    name: "Promises",
    definition: { ...defaultReport, kind: "service", overdue_only: true },
    schedule: defaultSchedule,
    archived: false,
  };
  ws = demoCommand(ws, save, now);
  ws = demoCommand(
    ws,
    {
      type: "queue_management_report",
      request_id: randomUUID(),
      id: reportId,
      revision: 1,
      run_id: randomUUID(),
    },
    now,
  );
  const saved = structuredClone(ws.report_runs![0].snapshot);
  ws.service_orders![0].status = "completed";
  ws = demoCommand(
    ws,
    { ...save, request_id: randomUUID(), revision: 1, name: "Changed" },
    now,
  );
  assert.deepEqual(ws.report_runs![0].snapshot, saved);
  assert.equal(saved!.metrics.find((m) => m.key === "promises")?.value, 1);
  assert.equal(
    buildManagementReport(
      ws,
      { ...defaultReport, kind: "service", overdue_only: true },
      "Now",
      now,
    ).rows.length,
    0,
  );
});
