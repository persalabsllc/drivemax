import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { demoWorkspace } from "../lib/demo";
import {
  demoCommand,
  visibleTasks,
  isOpenTask,
  type Opportunity,
} from "../lib/model";

const owner = "00000000-0000-4000-8000-000000000099";
const sales = "00000000-0000-4000-8000-000000000098";
const sales2 = "00000000-0000-4000-8000-000000000097";
const manager = "00000000-0000-4000-8000-000000000096";
const outsider = "00000000-0000-4000-8000-000000000095";
const org = "d5a1c100-0000-4000-8000-000000000001";
const org2 = "00000000-0000-4000-8000-000000000094";
const customer = {
  name: "Team Test Customer",
  email: "customer@example.invalid",
  phone: "2525550101",
  source: "Walk-in",
  status: "new",
  vehicle_interest: "Sample vehicle",
  trade_vehicle: "",
  birthday: "1990-03-04",
  initial_opportunity: true,
};
const opportunity = {
  title: "Repeat purchase",
  source: "Repeat customer",
  status: "working",
  inventory_id: null,
  vehicle_interest: "Another vehicle",
  vehicle_details: null,
  trade_vehicle: "",
  trade: null,
};

test("004 preserves history and routes opportunity, general, sold, and recurring tasks with enforced roles", async () => {
  const pg = new PGlite();
  const one = async <T>(sql: string, args: unknown[] = []) =>
    (await pg.query<T>(sql, args)).rows[0];
  const cmd = async (p: unknown, actor = owner, orgId = org) =>
    (
      await one<{ id: string }>("select dmcrm_command($1,$2,$3::jsonb) id", [
        orgId,
        actor,
        JSON.stringify(p),
      ])
    ).id;
  const assigned = async (table: string, id: string) =>
    (
      await one<{ assigned_to: string | null }>(
        `select assigned_to from dmcrm_${table} where id=$1`,
        [id],
      )
    ).assigned_to;
  const createStaff = (
    name: string,
    email: string,
    role = "sales",
    actor = owner,
  ) => cmd({ type: "save_staff", staff: { name, email, role } }, actor);
  const issue = (id: string, hash: string, actor = owner, orgId = org) =>
    pg.query("select dmcrm_create_staff_invite($1,$2,$3,$4)", [
      orgId,
      actor,
      id,
      hash,
    ]);
  const claim = (hash: string, user: string, email: string) =>
    pg.query("select dmcrm_claim_staff_invite($1,$2,$3)", [hash, user, email]);
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.staff(id uuid,name text,active boolean,role text);insert into auth.users values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${sales2}','sales2@example.invalid'),('${manager}','manager@example.invalid'),('${outsider}','outsider@example.invalid');insert into public.staff values('${owner}','Test Owner',true,'owner');`,
    );
    for (const file of [
      "001_crm.sql",
      "002_inventory_desking.sql",
      "003_opportunities_documents.sql",
    ])
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const cid = await cmd({ type: "create_customer", customer });
    const op = await one<Opportunity>(
      "select * from dmcrm_opportunities where customer_id=$1",
      [cid],
    );
    const completed = await cmd({
      type: "create_task",
      customer_id: cid,
      opportunity_id: op.id,
      title: "Completed before migration",
      due_date: "2026-10-26",
      kind: "task",
    });
    await cmd({ type: "complete_task", id: completed });
    await pg.exec(
      await fs.readFile(
        new URL("../db/004_team_assignments.sql", import.meta.url),
        "utf8",
      ),
    );
    const ownerStaff = (
      await one<{ id: string }>("select id from dmcrm_staff where user_id=$1", [
        owner,
      ])
    ).id;
    assert.equal(await assigned("customers", cid), ownerStaff);
    assert.equal(await assigned("opportunities", op.id), ownerStaff);
    assert.equal(await assigned("tasks", completed), ownerStaff);
    assert.equal(
      (await one<{ n: number }>("select count(*)::int n from public.staff")).n,
      1,
      "Control room staff untouched",
    );
    const a = await createStaff("Sales One", "sales@example.invalid");
    const b = await createStaff("Sales Two", "sales2@example.invalid");
    const m = await createStaff(
      "Manager",
      "manager@example.invalid",
      "manager",
    );
    for (const [staff, user, email, hash] of [
      [a, sales, "sales@example.invalid", "a".repeat(64)],
      [b, sales2, "sales2@example.invalid", "b".repeat(64)],
      [m, manager, "manager@example.invalid", "c".repeat(64)],
    ]) {
      await issue(staff, hash);
      await assert.rejects(
        claim(hash, outsider, email),
        /unavailable/,
        "Actual authenticated email must match",
      );
      await claim(hash, user, email);
      await assert.rejects(claim(hash, user, email), /already used/);
    }
    await assert.rejects(
      createStaff(
        "Imposter Manager",
        "new@example.invalid",
        "manager",
        manager,
      ),
      /Only the owner/,
    );
    await assert.rejects(
      createStaff("Nope", "new@example.invalid", "sales", sales),
      /Manager access/,
    );
    await assert.rejects(
      cmd({
        type: "save_staff",
        id: ownerStaff,
        staff: {
          name: "Changed",
          email: "owner@example.invalid",
          role: "sales",
        },
      }),
      /protected/,
    );
    await assert.rejects(
      cmd({
        type: "save_staff",
        id: a,
        staff: {
          name: "Sales One",
          email: "changed@example.invalid",
          role: "sales",
        },
      }),
      /email cannot be changed/,
    );
    await assert.rejects(issue(a, "d".repeat(64), sales), /Manager access/);
    await cmd({ type: "assign_opportunity", id: op.id, assigned_to: a });
    assert.equal(await assigned("opportunities", op.id), a);
    assert.equal(await assigned("customers", cid), a);
    assert.equal(
      await assigned("tasks", completed),
      ownerStaff,
      "Completed attribution stays intact",
    );
    const pending = await pg.query<{ assigned_to: string }>(
      "select assigned_to from dmcrm_tasks where customer_id=$1 and completed_at is null and canceled_at is null",
      [cid],
    );
    assert.ok(pending.rows.length >= 2);
    assert.ok(
      pending.rows.every((t) => t.assigned_to === a),
      "Birthday and unsold follow-up move together",
    );
    const ownTask = await cmd(
      {
        type: "create_task",
        customer_id: cid,
        opportunity_id: op.id,
        title: "Call buyer",
        due_date: "2026-10-27",
        kind: "task",
      },
      sales,
    );
    assert.equal(await assigned("tasks", ownTask), a);
    await assert.rejects(
      cmd({ type: "complete_task", id: ownTask }, sales2),
      /only complete your own/,
    );
    await assert.rejects(
      cmd(
        {
          type: "create_task",
          customer_id: cid,
          title: "Wrong owner",
          due_date: "2026-10-27",
          kind: "task",
        },
        sales2,
      ),
      /Only managers/,
    );
    await assert.rejects(
      cmd({ type: "assign_opportunity", id: op.id, assigned_to: b }, sales),
      /Manager access/,
    );
    await assert.rejects(
      cmd(
        {
          type: "update_opportunity",
          id: op.id,
          opportunity: { ...opportunity, assigned_to: b },
        },
        sales,
      ),
      /Manager access/,
    );
    await cmd({ type: "close_opportunity", id: op.id, outcome: "sold" }, sales);
    const snapshot = (
      await one<Opportunity>("select * from dmcrm_opportunities where id=$1", [
        op.id,
      ])
    ).sale_snapshot!;
    assert.equal(snapshot.salesperson?.id, a);
    const soldTasks = await pg.query<{ kind: string; assigned_to: string }>(
      "select kind,assigned_to from dmcrm_tasks where opportunity_id=$1 and completed_at is null and canceled_at is null",
      [op.id],
    );
    assert.equal(
      soldTasks.rows.filter((t) => t.kind === "sold_followup").length,
      3,
    );
    assert.ok(soldTasks.rows.every((t) => t.assigned_to === a));
    const anniversary = (
      await one<{ id: string }>(
        "select id from dmcrm_tasks where opportunity_id=$1 and kind='anniversary'",
        [op.id],
      )
    ).id;
    await cmd({ type: "complete_task", id: anniversary }, sales);
    const recurring = await one<{ assigned_to: string; due_date: string }>(
      "select assigned_to,due_date::text from dmcrm_tasks where opportunity_id=$1 and kind='anniversary' and completed_at is null",
      [op.id],
    );
    assert.equal(recurring.assigned_to, a);
    const repeat = await cmd({
      type: "create_opportunity",
      customer_id: cid,
      opportunity: { ...opportunity, assigned_to: b },
    });
    assert.equal(await assigned("customers", cid), b);
    await cmd({ type: "assign_opportunity", id: op.id, assigned_to: m });
    assert.equal(
      await assigned("customers", cid),
      b,
      "Old sale reassignment cannot steal new opportunity general follow-up",
    );
    assert.equal(
      await assigned("tasks", anniversary),
      a,
      "Completed recurrence remains attributed",
    );
    assert.deepEqual(
      (
        await one<Opportunity>(
          "select * from dmcrm_opportunities where id=$1",
          [op.id],
        )
      ).sale_snapshot,
      snapshot,
      "Sale snapshot preserved through reassignment",
    );
    const birthday = (
      await one<{ id: string }>(
        "select id from dmcrm_tasks where customer_id=$1 and kind='birthday' and completed_at is null and canceled_at is null",
        [cid],
      )
    ).id;
    await cmd({ type: "complete_task", id: birthday }, sales2);
    assert.equal(
      (
        await one<{ assigned_to: string }>(
          "select assigned_to from dmcrm_tasks where customer_id=$1 and kind='birthday' and completed_at is null and canceled_at is null",
          [cid],
        )
      ).assigned_to,
      b,
    );
    // No initial opportunity still routes birthday and manually added general tasks to the creator.
    const c2 = await cmd(
      {
        type: "create_customer",
        customer: { ...customer, initial_opportunity: false },
      },
      sales,
    );
    assert.equal(await assigned("customers", c2), a);
    const personal = await cmd(
      {
        type: "create_task",
        customer_id: null,
        title: "Personal reminder",
        due_date: "2026-10-27",
        kind: "task",
      },
      sales,
    );
    assert.equal(await assigned("tasks", personal), a);
    const explicit = await cmd(
      {
        type: "create_task",
        customer_id: cid,
        title: "Manager delegates",
        due_date: "2026-10-27",
        kind: "task",
        assigned_to: a,
      },
      manager,
    );
    assert.equal(await assigned("tasks", explicit), a);
    await pg.exec(
      `insert into dmcrm_orgs(id,name,slug) values('${org2}','Another dealer','team-test-other');insert into dmcrm_members values('${org2}','${outsider}','Other Owner','owner',true);insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org2}','${outsider}','Other Owner','outsider@example.invalid','owner');`,
    );
    const alien = (
      await one<{ id: string }>("select id from dmcrm_staff where org_id=$1", [
        org2,
      ])
    ).id;
    await assert.rejects(
      cmd({ type: "assign_opportunity", id: repeat, assigned_to: alien }),
      /active team member/,
    );
    await assert.rejects(
      cmd(
        { type: "assign_opportunity", id: repeat, assigned_to: alien },
        outsider,
        org2,
      ),
      /unavailable/,
    );
    await assert.rejects(
      cmd({ type: "set_staff_active", id: b, active: false }),
      /replacement/,
    );
    await cmd(
      { type: "set_staff_active", id: b, active: false, reassign_to: a },
      manager,
    );
    assert.equal(await assigned("opportunities", repeat), a);
    assert.equal(await assigned("customers", cid), a);
    assert.equal(
      await assigned("tasks", birthday),
      b,
      "Handoff leaves completed history unchanged",
    );
    await assert.rejects(
      cmd(
        {
          type: "create_task",
          customer_id: null,
          title: "Revoked",
          due_date: "2026-10-27",
          kind: "task",
        },
        sales2,
      ),
      /membership required/,
    );
    await assert.rejects(
      cmd({ type: "assign_opportunity", id: repeat, assigned_to: b }),
      /active team member/,
    );
    await cmd({ type: "set_staff_active", id: b, active: true });
    assert.equal(
      (
        await one<{ active: boolean }>(
          "select active from dmcrm_members where user_id=$1",
          [sales2],
        )
      ).active,
      true,
    );
    // Invitation expiry, replacement and cross-tenant protections.
    const newStaff = await createStaff("Pending", "pending@example.invalid");
    await issue(newStaff, "e".repeat(64));
    await issue(newStaff, "f".repeat(64));
    await assert.rejects(
      claim("e".repeat(64), outsider, "pending@example.invalid"),
      /expired or already used/,
    );
    await assert.rejects(
      issue(newStaff, "d".repeat(64), outsider, org2),
      /unavailable/,
    );
    await pg.query(
      "update dmcrm_staff_invites set expires_at=now()-interval '1 second' where staff_id=$1",
      [newStaff],
    );
    await assert.rejects(
      claim("f".repeat(64), outsider, "pending@example.invalid"),
      /expired/,
    );
    // Browser roles cannot bypass the API or invoke predecessor functions.
    for (const role of ["anon", "authenticated"]) {
      await pg.exec("set role " + role);
      await assert.rejects(
        pg.query("select * from dmcrm_staff"),
        /permission denied/,
      );
      await assert.rejects(
        pg.query("select * from dmcrm_staff_invites"),
        /permission denied/,
      );
      await assert.rejects(
        cmd({ type: "assign_opportunity", id: repeat, assigned_to: a }),
        /permission denied/,
      );
      await assert.rejects(
        issue(newStaff, "d".repeat(64)),
        /permission denied/,
      );
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    await assert.rejects(
      pg.query("select dmcrm_command_v3($1,$2,$3)", [
        org,
        owner,
        JSON.stringify({ type: "complete_task", id: ownTask }),
      ]),
      /permission denied/,
    );
    await assert.rejects(
      pg.query("select dmcrm_reassign_opportunity($1,$2,$3)", [org, repeat, a]),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});

test("demo assignments and task visibility match role and ownership rules", () => {
  let ws = demoWorkspace();
  const op = ws.opportunities[0],
    salesStaff = ws.staff.find((s) => s.role === "sales")!,
    ownerStaff = ws.member.staff_id!;
  const complete = ws.tasks.find(
    (t) => t.opportunity_id === op.id && !t.completed_at && !t.canceled_at,
  )!;
  ws = demoCommand(ws, { type: "complete_task", id: complete.id });
  ws = demoCommand(ws, {
    type: "assign_opportunity",
    id: op.id,
    assigned_to: salesStaff.id,
  });
  assert.equal(
    ws.tasks.find((t) => t.id === complete.id)!.assigned_to,
    ownerStaff,
  );
  assert.ok(
    ws.tasks
      .filter((t) => t.opportunity_id === op.id && isOpenTask(t))
      .every((t) => t.assigned_to === salesStaff.id),
  );
  ws.member = {
    id: "sales-demo",
    name: salesStaff.name,
    role: "sales",
    staff_id: salesStaff.id,
  };
  assert.ok(visibleTasks(ws).every((t) => t.assigned_to === salesStaff.id));
  assert.throws(
    () => demoCommand(ws, { type: "complete_task", id: complete.id }),
    /only complete your own/,
  );
  assert.throws(
    () =>
      demoCommand(ws, {
        type: "assign_opportunity",
        id: op.id,
        assigned_to: ownerStaff,
      }),
    /Manager access/,
  );
});
