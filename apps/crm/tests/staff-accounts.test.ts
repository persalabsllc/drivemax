import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { staffSchema, teamAccountSchema, mayManageStaff } from "../lib/team";
import { manageTeamAccount } from "../lib/team-accounts";
import {
  defaultCommission,
  emptyAccounting,
  saleMath,
  type Sale,
  type Commission,
} from "../lib/operations";
import { defaultQuote } from "../lib/model";

const org = "d5a1c100-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000099";
const sales = "00000000-0000-4000-8000-000000000098";
const manager = "00000000-0000-4000-8000-000000000097";
const otherOrg = "00000000-0000-4000-8000-000000000096";
const staff = staffSchema.parse({
  first_name: "Jamie",
  last_name: "Sales",
  email: "JAMIE@example.invalid",
  phone: "(252) 555-0123",
  address1: "123 Example Street",
  city: "New Bern",
  state: "nc",
  zip: "28560",
  role: "sales",
});

test("staff details require contact information and normalize phone/email without accepting privileged fields", () => {
  assert.equal(staff.phone, "+12525550123");
  assert.equal(staff.email, "jamie@example.invalid");
  assert.equal(staff.name, "Jamie Sales");
  for (const field of [
    "first_name",
    "last_name",
    "email",
    "phone",
    "address1",
    "city",
    "state",
    "zip",
  ]) {
    assert.equal(
      staffSchema.safeParse({ ...staff, [field]: "" }).success,
      false,
      field,
    );
  }
  assert.equal(
    staffSchema.safeParse({ ...staff, role: "owner" }).success,
    false,
  );
  assert.equal(
    staffSchema.safeParse({ ...staff, phone: "abc12525550123" }).success,
    false,
  );
  assert.equal(
    teamAccountSchema.safeParse({ action: "create", staff, password: "short" })
      .success,
    false,
  );
  assert.equal(
    mayManageStaff(
      { role: "manager", user_id: manager },
      { role: "manager", user_id: sales },
    ),
    false,
  );
  assert.equal(
    mayManageStaff(
      { role: "owner", user_id: owner },
      { role: "owner", user_id: owner },
    ),
    false,
  );
});

test("account provisioning uses admin auth, keeps passwords out of database RPCs, and safely handles failed links", async () => {
  const calls: { method: string; args: any }[] = [];
  let linkError = false,
    linkedCheck: unknown[] | null = [],
    checkError = false,
    denyTarget = false;
  const fake = {
    from(table: string) {
      const query: any = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
        async limit() {
          return { data: linkedCheck, error: checkError ? {} : null };
        },
        async insert(args: unknown) {
          calls.push({ method: table, args });
          return { error: null };
        },
      };
      return query;
    },
    async rpc(method: string, args: unknown) {
      calls.push({ method, args });
      if (method === "dmcrm_staff_password_target")
        return {
          data: { user_id: sales, email: staff.email },
          error: denyTarget ? {} : null,
        };
      return { data: sales, error: linkError ? {} : null };
    },
    auth: {
      admin: {
        async createUser(args: unknown) {
          calls.push({ method: "createUser", args });
          return { data: { user: { id: sales } }, error: null };
        },
        async deleteUser(args: unknown) {
          calls.push({ method: "deleteUser", args });
          return { error: null };
        },
        async updateUserById(id: string, args: unknown) {
          calls.push({
            method: "updateUserById",
            args: { id, ...(args as object) },
          });
          return { error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  const actor = { org_id: org, user_id: owner, role: "owner" };
  const request = teamAccountSchema.parse({
    action: "create",
    staff,
    password: "Synthetic-password-123",
  });
  await manageTeamAccount(fake, actor, request);
  assert.equal(
    calls.find((c) => c.method === "createUser")!.args.email_confirm,
    true,
  );
  assert.equal(
    calls.find((c) => c.method === "createUser")!.args.app_metadata
      .dmcrm_org_id,
    org,
  );
  const rpc = calls.find((c) => c.method === "dmcrm_create_staff_account")!;
  assert.equal(rpc.args.p_org, org);
  assert.equal(JSON.stringify(rpc).includes("Synthetic-password"), false);
  assert.equal(
    calls.some((c) => c.method === "deleteUser"),
    false,
  );
  calls.length = 0;
  await assert.rejects(
    manageTeamAccount(fake, { ...actor, role: "sales" }, request),
    /Manager access/,
  );
  assert.equal(calls.length, 0);
  linkError = true;
  await assert.rejects(
    manageTeamAccount(fake, actor, request),
    /could not be linked/,
  );
  assert.equal(calls.filter((c) => c.method === "deleteUser").length, 1);
  calls.length = 0;
  linkedCheck = [{ id: sales }];
  await assert.rejects(
    manageTeamAccount(fake, actor, request),
    /could not be linked/,
  );
  assert.equal(
    calls.some((c) => c.method === "deleteUser"),
    false,
    "An ambiguous response must never delete a committed account",
  );
  calls.length = 0;
  linkedCheck = null;
  checkError = true;
  await assert.rejects(
    manageTeamAccount(fake, actor, request),
    /could not be linked/,
  );
  assert.equal(
    calls.some((c) => c.method === "deleteUser"),
    false,
  );
  calls.length = 0;
  denyTarget = true;
  const reset = teamAccountSchema.parse({
    action: "set_password",
    staff_id: sales,
    password: "Synthetic-password-456",
  });
  await assert.rejects(
    manageTeamAccount(fake, actor, reset),
    /only for active CRM logins/,
  );
  assert.equal(
    calls.some((c) => c.method === "updateUserById"),
    false,
  );
  calls.length = 0;
  denyTarget = false;
  await manageTeamAccount(fake, actor, reset);
  assert.equal(calls.filter((c) => c.method === "updateUserById").length, 1);
  assert.equal(
    JSON.stringify(calls.find((c) => c.method === "dmcrm_audit")).includes(
      "Synthetic-password",
    ),
    false,
  );
});

test("staff account migrations enforce roles and preserve old earnings; new sale commissions exclude doc fees and recalculate safely", async () => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (p: unknown, actor = owner, orgId = org) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        orgId,
        actor,
        JSON.stringify(p),
      ])
    ).id as string;
  const migrate = async (name: string) =>
    pg.exec(
      await fs.readFile(new URL("../db/" + name, import.meta.url), "utf8"),
    );
  const target = (id: string, actor = owner, orgId = org) =>
    pg.query("select dmcrm_staff_password_target($1,$2,$3) target", [
      orgId,
      actor,
      id,
    ]);
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
      create table public.staff(id uuid,name text,active boolean,role text);
      insert into auth.users(id,email) values('${owner}','owner@example.invalid');
      insert into public.staff values('${owner}','Test Owner',true,'owner');`);
    for (const name of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^00[1-8]_.*\.sql$/.test(f))
      .sort())
      await migrate(name);
    const cid = await cmd({
      type: "create_customer",
      customer: {
        name: "Commission Buyer",
        email: "buyer@example.invalid",
        phone: "2525550101",
        source: "Walk-in",
        status: "new",
        vehicle_interest: "Sample car",
        trade_vehicle: "",
        birthday: null,
      },
    });
    const op = await one(
      "select * from dmcrm_opportunities where customer_id=$1",
      [cid],
    );
    const ownerStaff = await one("select * from dmcrm_staff where user_id=$1", [
      owner,
    ]);
    const snapshot = {
      customer: { name: "Commission Buyer" },
      opportunity: {
        ...op,
        vehicle_details: { cost: 10000, recon: 500 },
        trade: null,
      },
      salesperson: { id: ownerStaff.id, name: ownerStaff.name },
      quote: {
        values: {
          ...defaultQuote,
          price: 14000,
          docFee: 399,
          products: [
            { id: sales, kind: "service_contract", price: 1500, cost: 600 },
          ],
        },
        vehicle_details: { cost: 10000, recon: 500 },
      },
    };
    const oldSale = await one(
      "insert into dmcrm_sales(org_id,opportunity_id,customer_id,sold_on,snapshot) values($1,$2,$3,'2026-10-26',$4) returning *",
      [org, op.id, cid, JSON.stringify(snapshot)],
    );
    const commissionId = crypto.randomUUID();
    await pg.query(
      "insert into dmcrm_commissions(id,org_id,sale_id,staff_id,staff_name,category,amount,paid_amount,paid_on) values($1,$2,$3,$4,'Test Owner','sales',123.45,30,'2026-10-26')",
      [commissionId, org, oldSale.id, ownerStaff.id],
    );
    await migrate("009_staff_accounts.sql");
    await migrate("010_default_commissions.sql");
    const oldCommission = await one(
      "select * from dmcrm_commissions where id=$1",
      [commissionId],
    );
    assert.equal(Number(oldCommission.amount), 123.45);
    assert.equal(Number(oldCommission.paid_amount), 30);
    assert.equal(oldCommission.calculation, "manual");
    assert.equal(
      (
        await one("select first_name from dmcrm_staff where id=$1", [
          ownerStaff.id,
        ])
      ).first_name,
      "Test",
    );
    await assert.rejects(
      cmd({
        type: "save_staff",
        staff: {
          name: "Incomplete",
          email: "none@example.invalid",
          role: "sales",
        },
      }),
      /complete address/,
    );
    await pg.query(
      "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3),($4,'manager@example.invalid',$3)",
      [sales, staff.email, { dmcrm_org_id: org }, manager],
    );
    const sid = (
      await one("select dmcrm_create_staff_account($1,$2,$3,$4) id", [
        org,
        owner,
        staff,
        sales,
      ])
    ).id;
    assert.equal(
      (await one("select * from dmcrm_staff where id=$1", [sid])).phone,
      "+12525550123",
    );
    assert.equal(
      (await one("select * from dmcrm_staff where id=$1", [sid]))
        .password_managed,
      true,
    );
    assert.equal((await target(sid)).rows.length, 1);
    const mid = (
      await one("select dmcrm_create_staff_account($1,$2,$3,$4) id", [
        org,
        owner,
        {
          ...staff,
          first_name: "Morgan",
          email: "manager@example.invalid",
          role: "manager",
        },
        manager,
      ])
    ).id;
    await assert.rejects(target(ownerStaff.id), /not available/);
    await assert.rejects(target(mid, manager), /not available/);
    await assert.rejects(target(sid, sales), /Manager access/);
    await assert.rejects(target(sid, owner, otherOrg), /Manager access/);
    await assert.rejects(
      cmd(
        {
          type: "save_staff",
          staff: { ...staff, email: "other@example.invalid", role: "manager" },
        },
        manager,
      ),
      /Only the owner/,
    );
    await assert.rejects(
      cmd({ type: "save_staff", id: ownerStaff.id, staff }),
      /protected/,
    );
    await assert.rejects(
      cmd({
        type: "save_staff",
        id: sid,
        staff: { ...staff, email: "wrong@example.invalid" },
      }),
      /email cannot/,
    );
    await pg.query("update dmcrm_staff set active=false where id=$1", [sid]);
    await assert.rejects(target(sid), /not available/);
    await pg.query(
      "update dmcrm_staff set active=true,password_managed=false where id=$1",
      [sid],
    );
    await assert.rejects(target(sid), /existing account/);
    await pg.query("update dmcrm_staff set password_managed=true where id=$1", [
      sid,
    ]);
    await pg.query(
      "insert into public.staff values($1,'Other application user',true,'sales')",
      [sales],
    );
    await assert.rejects(target(sid), /existing account/);
    await pg.query("delete from public.staff where id=$1", [sales]);

    // A real close-opportunity command must create exactly two default entries.
    await pg.query("update dmcrm_sales set status='unwound' where id=$1", [
      oldSale.id,
    ]);
    await cmd({
      type: "update_opportunity",
      id: op.id,
      opportunity: {
        ...op,
        vehicle_details: {
          vin: "1HGCM82633A004352",
          stock_number: "DM200",
          year: 2018,
          make: "Honda",
          model: "Accord",
          trim: "",
          mileage: 80000,
          color: "Blue",
          cost: 10000,
          recon: 500,
          price: 14000,
          acquired_on: "2026-10-01",
        },
      },
    });
    await cmd({
      type: "save_quote",
      customer_id: cid,
      opportunity_id: op.id,
      vehicle: "Sample car",
      values: snapshot.quote.values,
      vehicle_details: {
        vin: "1HGCM82633A004352",
        stock_number: "DM200",
        year: 2018,
        make: "Honda",
        model: "Accord",
        trim: "",
        mileage: 80000,
        color: "Blue",
        cost: 10000,
        recon: 500,
        price: 14000,
        acquired_on: "2026-10-01",
      },
      inventory_id: null,
      trade: null,
    });
    await cmd({ type: "close_opportunity", id: op.id, outcome: "sold" });
    let sale = (await one(
      "select * from dmcrm_sales where opportunity_id=$1 and status='sold'",
      [op.id],
    )) as Sale;
    let rows = (
      await pg.query<Commission>(
        "select * from dmcrm_commissions where sale_id=$1 order by category",
        [sale.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.calculation, "default");
      assert.equal(Number(row.amount), defaultCommission(sale, row.category));
    }
    assert.equal(Number(rows.find((r) => r.category === "sales")!.amount), 875);
    assert.equal(Number(rows.find((r) => r.category === "fi")!.amount), 45);
    await cmd({ type: "close_opportunity", id: op.id, outcome: "sold" });
    assert.equal(
      (
        await one(
          "select count(*)::int n from dmcrm_commissions where sale_id=$1",
          [sale.id],
        )
      ).n,
      2,
    );
    const accounting = {
      ...emptyAccounting,
      vehicle_cost: 10000,
      recon: 500,
      pack: 400,
      finance_reserve: 250,
    };
    const entries = rows.map((r) => ({
      ...r,
      amount: 999999,
      paid_amount: 0,
      paid_on: "",
    }));
    await cmd({
      type: "save_accounting",
      sale_id: sale.id,
      revision: 0,
      accounting,
      commissions: entries,
    });
    sale = await one("select * from dmcrm_sales where id=$1", [sale.id]);
    rows = (
      await pg.query<Commission>(
        "select * from dmcrm_commissions where sale_id=$1 order by category",
        [sale.id],
      )
    ).rows;
    assert.equal(
      Number(rows.find((r) => r.category === "sales")!.amount),
      775,
      "Server ignores forged automatic amount and excludes doc fee",
    );
    assert.equal(Number(rows.find((r) => r.category === "fi")!.amount), 57.5);
    assert.equal(
      saleMath(sale).front,
      3899,
      "Doc fee still contributes to business profit",
    );
    assert.equal(saleMath(sale).payableFront, 3100);
    for (const changed of [
      { ...sale },
      { ...sale, accounting: { ...accounting, pack: 999999 } },
      {
        ...sale,
        accounting: { ...accounting, product_costs: { [sales]: null } },
      },
      {
        ...sale,
        accounting: { ...accounting, recon: 500.01, vehicle_cost: 14000 },
      },
      { ...sale, snapshot: { ...sale.snapshot, quote: null } },
      {
        ...sale,
        snapshot: {
          ...sale.snapshot,
          quote: {
            ...sale.snapshot.quote!,
            values: { ...sale.snapshot.quote!.values, docFee: 9999 },
          },
        },
      },
    ])
      for (const category of ["sales", "fi"] as const) {
        const dbAmount = (
          await one("select dmcrm_default_commission($1,$2) amount", [
            changed,
            category,
          ])
        ).amount;
        assert.equal(
          dbAmount === null ? null : Number(dbAmount),
          defaultCommission(changed, category),
        );
      }
    const paidEntries = rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      paid_amount: r.category === "sales" ? 100 : 0,
      paid_on: r.category === "sales" ? "2026-10-26" : "",
    }));
    await cmd({
      type: "save_accounting",
      sale_id: sale.id,
      revision: 1,
      accounting,
      commissions: paidEntries,
    });
    await assert.rejects(
      cmd({
        type: "save_accounting",
        sale_id: sale.id,
        revision: 2,
        accounting: { ...accounting, pack: 99999 },
        commissions: paidEntries,
      }),
      /below the paid amount/,
    );
    await cmd({
      type: "save_accounting",
      sale_id: sale.id,
      revision: 2,
      accounting: { ...accounting, product_costs: { [sales]: null } },
      commissions: paidEntries,
    });
    const pending = await one(
      "select * from dmcrm_commissions where sale_id=$1 and category='fi'",
      [sale.id],
    );
    assert.equal(pending.pending, true);
    assert.equal(Number(pending.amount), 0);
    await assert.rejects(
      cmd({
        type: "save_accounting",
        sale_id: sale.id,
        revision: 3,
        accounting,
        commissions: [],
      }),
      /paid commissions/,
    );
    await assert.rejects(
      cmd(
        {
          type: "save_accounting",
          sale_id: sale.id,
          revision: 3,
          accounting,
          commissions: paidEntries,
        },
        sales,
      ),
      /Manager access/,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      await pg.exec("set role " + role);
      await assert.rejects(
        pg.query("select dmcrm_command_v9($1,$2,$3)", [org, owner, {}]),
        /permission denied/,
      );
      if (role !== "service_role") {
        await assert.rejects(target(sid), /permission denied/);
        await assert.rejects(
          pg.query("select * from dmcrm_staff"),
          /permission denied/,
        );
      }
      await pg.exec("reset role");
    }
  } finally {
    await pg.close();
  }
});
