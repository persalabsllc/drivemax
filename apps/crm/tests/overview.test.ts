import { test } from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace } from "../lib/demo";
import { overviewFunnel } from "../lib/overview-funnel";
import { commandSchema, demoCommand } from "../lib/model";
import type { Message } from "../lib/operations";

test("overview activity buckets deduplicate repeat deals, respect Eastern dates, and exclude automated contact and unwinds", () => {
  const ws = demoWorkspace(),
    [a, b] = ws.customers,
    template = ws.opportunities[0];
  ws.customers = [a, b];
  ws.opportunities = [
    {
      ...template,
      id: "a1",
      customer_id: a.id,
      created_at: "2026-10-01T04:00:00Z",
      status: "new",
      sold_on: null,
      assigned_to: ws.member.staff_id,
    },
    {
      ...template,
      id: "a2",
      customer_id: a.id,
      created_at: "2026-10-02T12:00:00Z",
      status: "sold",
      sold_on: "2026-10-10",
      assigned_to: ws.member.staff_id,
    },
    {
      ...template,
      id: "b1",
      customer_id: b.id,
      created_at: "2026-10-01T03:59:59Z",
      status: "working",
      sold_on: "2026-10-09",
      assigned_to: ws.staff[1].id,
    },
  ];
  ws.activities = [];
  ws.appointments = [];
  ws.visits = [];
  ws.sales_events = [];
  const message: Message = {
    id: "message",
    org_id: ws.org.id,
    customer_id: b.id,
    opportunity_id: "b1",
    task_id: null,
    channel: "email",
    direction: "outbound",
    status: "sent",
    recipient: b.email,
    subject: "Thanks",
    body: "Automatic",
    created_at: "2026-10-10T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
    created_by: "00000000-0000-4000-8000-000000000000",
    quote_id: null,
    revision: 0,
  };
  ws.messages = [message];
  let buckets = overviewFunnel(ws, "2026-10-01", "2026-10-31");
  assert.equal(buckets.leads.length, 1);
  assert.deepEqual(buckets.leads[0].opportunityIds, ["a1", "a2"]);
  assert.equal(buckets.contacted.length, 0);
  assert.deepEqual(
    buckets.sold.map((r) => r.customer.id),
    [a.id],
    "an unwound working opportunity with a historical sold date is excluded",
  );
  ws.messages.push({
    ...message,
    id: "human",
    created_by: ws.member.id,
    created_at: "2026-09-30T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
  });
  ws.visits = [
    {
      id: "v1",
      org_id: ws.org.id,
      customer_id: a.id,
      opportunity_id: "a1",
      arrived_at: "2026-10-11T12:00:00Z",
      departed_at: null,
      outcome: "browsing",
    },
    {
      id: "v2",
      org_id: ws.org.id,
      customer_id: a.id,
      opportunity_id: "a2",
      arrived_at: "2026-10-12T12:00:00Z",
      departed_at: null,
      outcome: "browsing",
    },
  ];
  buckets = overviewFunnel(ws, "2026-10-01", "2026-10-31");
  assert.equal(
    buckets.contacted.length,
    1,
    "a saved draft sent this month counts when sent",
  );
  assert.equal(buckets.visits.length, 1);
  ws.member = { ...ws.member, role: "sales", staff_id: ws.staff[1].id };
  buckets = overviewFunnel(ws, "2026-10-01", "2026-10-31");
  assert.equal(buckets.leads.length, 0);
  assert.equal(buckets.visits.length, 0);
  assert.equal(buckets.sold.length, 0);
  assert.equal(buckets.contacted.length, 1);
});

test("appointment buckets exclude cancellations and collapse multiple appointments for one customer", () => {
  const ws = demoWorkspace(),
    source = ws.appointments![0],
    c = ws.customers[0],
    o = ws.opportunities.find((o) => o.customer_id === c.id)!;
  ws.appointments = [
    {
      ...source,
      id: "a",
      customer_id: c.id,
      opportunity_id: o.id,
      starts_at: "2026-10-20T13:00:00Z",
      status: "confirmed",
    },
    {
      ...source,
      id: "b",
      customer_id: c.id,
      opportunity_id: o.id,
      starts_at: "2026-10-21T13:00:00Z",
      status: "canceled",
    },
  ];
  ws.visits = [];
  ws.sales_events = [];
  assert.equal(
    overviewFunnel(ws, "2026-10-01", "2026-10-31").appointments.length,
    1,
  );
  assert.equal(
    overviewFunnel(ws, "2026-10-21", "2026-10-21").appointments.length,
    0,
  );
  ws.appointments[0].status = "arrived";
  assert.equal(overviewFunnel(ws, "2026-10-20", "2026-10-20").visits.length, 1);
});

test("profile name validation and demo keep staff and membership in sync without accepting access fields", () => {
  const ws = demoWorkspace();
  assert.equal(
    commandSchema.safeParse({
      type: "save_profile_name",
      profile: { first_name: "Kyle", last_name: " " },
    }).success,
    false,
  );
  const parsed = commandSchema.parse({
    type: "save_profile_name",
    role: "owner",
    profile: { first_name: " Kyle ", last_name: " Kratoville " },
  });
  const next = demoCommand(ws, parsed);
  assert.equal(next.member.name, "Kyle Kratoville");
  assert.equal(
    next.staff.find((s) => s.id === next.member.staff_id)!.name,
    "Kyle Kratoville",
  );
  assert.equal(next.member.role, ws.member.role);
});
