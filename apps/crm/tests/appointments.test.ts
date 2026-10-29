import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { commandSchema, demoCommand, type Command } from "../lib/model";
import { demoWorkspace } from "../lib/demo";
import {
  appointmentInstant,
  appointmentLocalParts,
  appointmentsForRange,
  overlappingAppointments,
  type Appointment,
  type AppointmentInput,
} from "../lib/appointments";

const owner = "00000000-0000-4000-8000-000000000099",
  salesUser = "00000000-0000-4000-8000-000000000098",
  outsider = "00000000-0000-4000-8000-000000000097",
  org = "d5a1c100-0000-4000-8000-000000000001";
const customer = {
  name: "Appointment Test Buyer",
  email: "buyer@example.invalid",
  phone: "2525550197",
  source: "Phone",
  status: "new",
  vehicle_interest: "Honda Accord",
  trade_vehicle: "",
  birthday: null,
  initial_opportunity: true,
};
const details = {
  kind: "return_visit" as const,
  starts_at: "2026-10-27T18:00:00.000Z",
  duration_minutes: 60,
  description: "Returning with spouse for a test drive.",
};

test("appointment dates are Eastern across DST and ranges include the complete last day", () => {
  assert.equal(
    appointmentInstant("2026-10-27", "14:00"),
    "2026-10-27T18:00:00.000Z",
  );
  assert.equal(
    appointmentInstant("2026-12-03", "14:00"),
    "2026-12-03T19:00:00.000Z",
  );
  assert.deepEqual(appointmentLocalParts("2026-10-28T03:30:00Z"), {
    date: "2026-10-27",
    time: "23:30",
  });
  assert.throws(
    () => appointmentInstant("2026-03-08", "02:30"),
    /clock change/,
  );
  assert.throws(
    () => appointmentInstant("2026-11-01", "01:30"),
    /clock change/,
  );
  assert.throws(() => appointmentInstant("2026-02-30", "10:00"), /valid/);
  const s = demoWorkspace(new Date("2026-10-26T16:00:00Z"));
  const a = {
    ...s.appointments![0],
    starts_at: appointmentInstant("2026-10-27", "23:30"),
  };
  const list = [
    a,
    { ...a, id: "canceled", status: "canceled" as const },
    {
      ...a,
      id: "next-day",
      starts_at: appointmentInstant("2026-10-28", "00:00"),
    },
  ];
  assert.deepEqual(
    appointmentsForRange(list, "2026-10-27", "2026-10-27").map((a) => a.id),
    [a.id],
  );
  assert.equal(
    appointmentsForRange(list, "2026-10-27", "2026-10-27", s.staff[1].id)
      .length,
    0,
  );
  const input = { ...a, starts_at: appointmentInstant("2026-10-28", "00:00") };
  assert.equal(overlappingAppointments([a], input, "new").length, 1);
  assert.equal(
    overlappingAppointments(
      [a],
      { ...input, starts_at: appointmentInstant("2026-10-28", "00:30") },
      "new",
    ).length,
    0,
  );
  assert.equal(overlappingAppointments([a], input, a.id).length, 0);
  for (const invalid of [
    { starts_at: "2026-02-30T10:00:00Z" },
    { duration_minutes: 0 },
    { duration_minutes: 20 },
    { kind: "bogus" },
    { assigned_to: "" },
    { description: "x".repeat(1001) },
  ])
    assert.equal(
      commandSchema.safeParse({
        type: "save_appointment",
        id: crypto.randomUUID(),
        revision: 0,
        appointment: { ...a, ...invalid },
      }).success,
      false,
    );
  assert.equal(
    commandSchema.safeParse({
      type: "create_customer",
      customer,
      appointment: {
        ...details,
        id: crypto.randomUUID(),
        assigned_to: s.staff[0].id,
      },
    }).success,
    true,
  );
});

test("006 appointment lifecycle is atomic, audited, scoped and protected by ownership and revisions", async () => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (p: unknown, user = owner, organization = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        user,
        JSON.stringify(p),
      ])
    ).id as string;
  const get = (id: string) =>
    one("select * from dmcrm_appointments where id=$1", [id]);
  const count = async (table: string) =>
    (await one(`select count(*)::int n from dmcrm_${table}`)).n;
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}','owner@example.invalid'),('${salesUser}','sales@example.invalid'),('${outsider}','outsider@example.invalid');insert into public.staff values('${owner}','Test Owner',true,'owner');`,
    );
    const files = (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^00[1-5]_.*\.sql$/.test(f))
      .sort();
    for (const file of files)
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const legacy = await cmd({ type: "create_customer", customer });
    const legacyTask = await cmd({
      type: "create_task",
      customer_id: legacy,
      title: "Legacy date-only appointment",
      due_date: "2026-10-27",
      kind: "appointment",
    });
    const beforeMigration = await one("select * from dmcrm_tasks where id=$1", [
      legacyTask,
    ]);
    await pg.exec(
      await fs.readFile(
        new URL("../db/006_appointments.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      await one("select * from dmcrm_tasks where id=$1", [legacyTask]),
      beforeMigration,
    );
    assert.equal(
      await count("appointments"),
      0,
      "Do not invent times for old tasks",
    );
    const ownerStaff = (
      await one("select id from dmcrm_staff where user_id=$1", [owner])
    ).id;
    const salesStaff = await cmd({
      type: "save_staff",
      staff: {
        name: "Test Salesperson",
        email: "sales@example.invalid",
        role: "sales",
      },
    });
    await pg.query("update dmcrm_staff set user_id=$1 where id=$2", [
      salesUser,
      salesStaff,
    ]);
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Test Salesperson','sales')",
      [org, salesUser],
    );
    const aid = crypto.randomUUID();
    const cid = await cmd({
      type: "create_customer",
      customer,
      appointment: { ...details, id: aid, assigned_to: salesStaff },
    });
    const a = await get(aid),
      oid = a.opportunity_id;
    assert.equal(a.customer_id, cid);
    assert.ok(oid);
    assert.equal(a.assigned_to, salesStaff);
    assert.equal(a.status, "scheduled");
    assert.equal(new Date(a.starts_at).toISOString(), details.starts_at);
    assert.equal(await count("appointment_history"), 1);
    const input: AppointmentInput = {
      ...details,
      customer_id: cid,
      opportunity_id: oid,
      assigned_to: salesStaff,
    };
    const save = {
      type: "save_appointment",
      id: aid,
      revision: 0,
      appointment: input,
    };
    await cmd(save); // A duplicate initial request is a no-op, not a second appointment.
    assert.equal(await count("appointment_history"), 1);
    await assert.rejects(
      cmd({ ...save, appointment: { ...input, customer_id: legacy } }),
      /Customer unavailable/,
    );
    const legacyOpp = (
      await one("select id from dmcrm_opportunities where customer_id=$1", [
        legacy,
      ])
    ).id;
    await assert.rejects(
      cmd({ ...save, appointment: { ...input, opportunity_id: legacyOpp } }),
      /Opportunity unavailable/,
    );
    await assert.rejects(cmd(save, outsider), /membership/);
    await assert.rejects(
      cmd(
        { ...save, appointment: { ...input, assigned_to: ownerStaff } },
        salesUser,
      ),
      /Only managers/,
    );
    await cmd(
      {
        type: "set_appointment_status",
        id: aid,
        revision: 0,
        status: "confirmed",
      },
      salesUser,
    );
    await assert.rejects(cmd(save, salesUser), /changed in another session/);
    const rescheduled = {
      ...input,
      starts_at: "2026-10-28T19:00:00.000Z",
      description: "Spouse is available Wednesday instead.",
    };
    await cmd({ ...save, revision: 1, appointment: rescheduled }, salesUser);
    assert.equal(
      (await get(aid)).status,
      "scheduled",
      "Rescheduling requires a new confirmation",
    );
    assert.equal((await get(aid)).revision, 2);
    const history = await one(
      "select * from dmcrm_appointment_history where appointment_id=$1 and event='rescheduled'",
      [aid],
    );
    assert.equal(history.before_record.status, "confirmed");
    assert.match(history.after_record.description, /Wednesday/);
    const log = await one(
      "select body from dmcrm_activities where customer_id=$1 and body like 'Appointment rescheduled%'",
      [cid],
    );
    assert.match(log.body, /Previously/);
    assert.match(log.body, /Eastern/);
    await cmd(
      {
        type: "set_appointment_status",
        id: aid,
        revision: 2,
        status: "arrived",
      },
      salesUser,
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from dmcrm_visits where customer_id=$1 and departed_at is null",
          [cid],
        )
      ).n,
      1,
    );
    await assert.rejects(
      cmd({ ...save, revision: 3, appointment: input }),
      /cannot be rescheduled/,
    );
    await assert.rejects(
      cmd({
        type: "set_appointment_status",
        id: aid,
        revision: 3,
        status: "no_show",
      }),
      /Invalid appointment/,
    );
    await cmd({
      type: "set_appointment_status",
      id: aid,
      revision: 3,
      status: "completed",
    });
    assert.equal((await get(aid)).status, "completed");
    assert.equal(
      (
        await one(
          "select count(*)::int n from dmcrm_visits where customer_id=$1 and departed_at is null",
          [cid],
        )
      ).n,
      1,
      "Completing appointment does not check out the visitor",
    );
    await assert.rejects(cmd({ ...save, revision: 4 }), /closed/);

    // Delivery and service remain schedulable on a closed sale without reopening it.
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    const deliveryId = crypto.randomUUID();
    await cmd({
      ...save,
      id: deliveryId,
      appointment: { ...input, kind: "sold_delivery" },
    });
    assert.equal(
      (await one("select status from dmcrm_opportunities where id=$1", [oid]))
        .status,
      "sold",
    );
    await cmd({
      type: "unwind_sale",
      opportunity_id: oid,
      reason: "Test financing failed",
    });
    assert.equal(
      (await get(deliveryId)).status,
      "scheduled",
      "Deal changes do not silently delete a scheduled visit",
    );
    await cmd({
      type: "set_appointment_status",
      id: deliveryId,
      revision: 0,
      status: "canceled",
    });

    const personalId = crypto.randomUUID();
    await cmd({
      ...save,
      id: personalId,
      appointment: { ...input, assigned_to: ownerStaff, opportunity_id: null },
    });
    await assert.rejects(
      cmd(
        {
          type: "set_appointment_status",
          id: personalId,
          revision: 0,
          status: "no_show",
        },
        salesUser,
      ),
      /own appointments/,
    );
    const pendingId = crypto.randomUUID();
    await cmd({ ...save, id: pendingId }, salesUser);
    await cmd({
      type: "set_staff_active",
      id: salesStaff,
      active: false,
      reassign_to: ownerStaff,
    });
    assert.equal((await get(pendingId)).assigned_to, ownerStaff);
    assert.equal((await get(pendingId)).revision, 1);
    assert.equal(
      (await get(aid)).assigned_to,
      salesStaff,
      "Completed appointment attribution is preserved",
    );
    assert.equal(
      (await get(deliveryId)).assigned_to,
      salesStaff,
      "Canceled appointment attribution is preserved",
    );
    await assert.rejects(
      cmd({ ...save, id: crypto.randomUUID() }),
      /active team member/,
    );
    const customersBefore = await count("customers"),
      tasksBefore = await count("tasks");
    await assert.rejects(
      cmd({
        type: "create_customer",
        customer,
        appointment: {
          ...details,
          id: crypto.randomUUID(),
          assigned_to: salesStaff,
        },
      }),
      /active team member/,
    );
    assert.equal(
      await count("customers"),
      customersBefore,
      "Appointment failure rolls back the customer too",
    );
    assert.equal(await count("tasks"), tasksBefore);

    const otherOrg = crypto.randomUUID(),
      otherCustomer = crypto.randomUUID(),
      otherStaff = crypto.randomUUID();
    await pg.query(
      "insert into dmcrm_orgs(id,name,slug) values($1,'Other','other')",
      [otherOrg],
    );
    await pg.query(
      "insert into dmcrm_customers(id,org_id,name) values($1,$2,'Other Customer')",
      [otherCustomer, otherOrg],
    );
    await pg.query(
      "insert into dmcrm_staff(id,org_id,user_id,name,role) values($1,$2,$3,'Other Owner','owner')",
      [otherStaff, otherOrg, outsider],
    );
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Other Owner','owner')",
      [otherOrg, outsider],
    );
    await assert.rejects(
      cmd({ ...save, id: personalId }, outsider, otherOrg),
      /Appointment unavailable/,
    );
    await assert.rejects(
      cmd({
        ...save,
        id: crypto.randomUUID(),
        appointment: {
          ...input,
          customer_id: otherCustomer,
          assigned_to: ownerStaff,
        },
      }),
      /Customer unavailable/,
    );
    await assert.rejects(
      cmd({
        ...save,
        id: crypto.randomUUID(),
        appointment: { ...input, assigned_to: otherStaff },
      }),
      /active team member/,
    );
    const generalId = crypto.randomUUID();
    const generalCustomer = await cmd({
      type: "create_customer",
      customer: { ...customer, initial_opportunity: false },
      appointment: {
        ...details,
        id: generalId,
        assigned_to: ownerStaff,
        kind: "service",
      },
    });
    assert.equal((await get(generalId)).customer_id, generalCustomer);
    assert.equal((await get(generalId)).opportunity_id, null);
    await cmd({
      type: "set_appointment_status",
      id: generalId,
      revision: 0,
      status: "no_show",
    });
    assert.equal((await get(generalId)).status, "no_show");
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      await assert.rejects(
        pg.query("select * from dmcrm_appointments"),
        /permission denied/,
      );
      await assert.rejects(
        pg.query("select * from dmcrm_appointment_history"),
        /permission denied/,
      );
      await assert.rejects(
        cmd({ ...save, id: crypto.randomUUID() }),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    await assert.rejects(
      pg.query("select dmcrm_command_v5($1,$2,'{}'::jsonb)", [org, owner]),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});

test("demo mirrors new-customer scheduling, return visits, arrival, history and handoffs", () => {
  const now = new Date("2026-10-26T16:00:00Z");
  let s = demoWorkspace(now);
  const staff = s.staff[1].id,
    ownerStaff = s.staff[0].id,
    id = crypto.randomUUID();
  s = demoCommand(
    s,
    commandSchema.parse({
      type: "create_customer",
      customer,
      appointment: { ...details, id, assigned_to: staff },
    }),
    now,
  );
  const c = s.customers[0],
    a = s.appointments!.find((a) => a.id === id)!;
  assert.equal(a.customer_id, c.id);
  assert.ok(a.opportunity_id);
  const command: Command = {
    type: "save_appointment",
    id,
    revision: 0,
    appointment: { ...a, starts_at: "2026-10-28T18:00:00.000Z" },
  };
  s = demoCommand(s, command, now);
  assert.match(s.activities[0].body, /rescheduled.*Previously/);
  assert.throws(() => demoCommand(s, command, now), /another session/);
  s = demoCommand(
    s,
    { type: "set_appointment_status", id, revision: 1, status: "arrived" },
    now,
  );
  assert.equal(
    s.visits.filter((v) => v.customer_id === c.id && !v.departed_at).length,
    1,
  );
  s = demoCommand(
    s,
    { type: "set_appointment_status", id, revision: 2, status: "completed" },
    now,
  );
  const returnId = crypto.randomUUID();
  s = demoCommand(s, { ...command, id: returnId, revision: 0 }, now);
  s = demoCommand(
    s,
    {
      type: "set_staff_active",
      id: staff,
      active: false,
      reassign_to: ownerStaff,
    },
    now,
  );
  assert.equal(s.appointments!.find((a) => a.id === id)!.assigned_to, staff);
  assert.equal(
    s.appointments!.find((a) => a.id === returnId)!.assigned_to,
    ownerStaff,
  );
  assert.equal(s.appointments!.find((a) => a.id === returnId)!.revision, 1);
});
