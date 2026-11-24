import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { paymentCommandSchema, type Payment } from "../lib/payments";

const org = randomUUID();
const otherOrg = randomUUID();
const actor = randomUUID();
const employee = randomUUID();
const vehicle = randomUUID();
const otherVehicle = randomUUID();
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table dmcrm_orgs(id uuid primary key);
    create table dmcrm_members(org_id uuid, user_id uuid, role text, active boolean);
    create table dmcrm_staff(id uuid, org_id uuid, user_id uuid, name text, role text, active boolean, unique(org_id,id));
    create table dmcrm_inventory(id uuid, org_id uuid, stock_number text, year integer, make text,
      model text, trim text, deleted_at timestamptz, unique(org_id,id));
  `);
  await db.query("insert into dmcrm_orgs values ($1),($2)", [org, otherOrg]);
  await db.query("insert into dmcrm_members values ($1,$2,'sales',true)", [org, actor]);
  await db.query("insert into dmcrm_staff values ($1,$2,$3,'Test Employee','sales',true)", [employee, org, actor]);
  await db.query(`insert into dmcrm_inventory values
    ($1,$2,'DM101',2018,'Nissan','Versa','SV',null),
    ($3,$4,'OTHER',2019,'Ford','Fusion','',null)`, [vehicle, org, otherVehicle, otherOrg]);
  await db.exec(await readFile(new URL("../db/047_card_payments.sql", import.meta.url), "utf8"));
});

after(async () => { await db?.close(); });

const draft = () => ({
  action: "create" as const, id: randomUUID(), employee_id: employee, inventory_id: vehicle,
  amount_cents: 12345, payer_name: "Example Buyer", purpose: "Vehicle deposit",
});

type Row = Payment & { revision: number; stripe_intent_id: string | null };

async function reserve(data: ReturnType<typeof draft>, orgId: string = org, userId: string = actor) {
  const result = await db.query<{ payment: Row }>(
    "select dmcrm_reserve_card_payment($1,$2,$3::jsonb) as payment",
    [orgId, userId, JSON.stringify(paymentCommandSchema.parse(data))],
  );
  return result.rows[0].payment;
}

async function sync(row: Row, intent: string, status: Payment["status"], options: {
  live?: boolean; paidAt?: string; brand?: string; last4?: string; orgId?: string;
} = {}) {
  const result = await db.query<{ payment: Row }>(
    "select dmcrm_sync_card_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) as payment",
    [options.orgId ?? org, row.id, row.revision, intent, status, options.live ?? false,
      options.paidAt ?? null, options.brand ?? null, options.last4 ?? null],
  );
  return result.rows[0].payment;
}

test("reservations bind retries to the cashier, vehicle, payer and amount", async () => {
  const data = draft();
  const [first, retry] = await Promise.all([reserve(data), reserve(data)]);
  assert.deepEqual(retry, first);
  assert.equal(first.status, "pending");
  assert.equal(first.paid_at, null);
  assert.equal(first.stripe_intent_id, null);
  assert.equal(first.stock_number, "DM101");
  assert.equal(first.vehicle_name, "2018 Nissan Versa SV");
  assert.equal(first.employee_name, "Test Employee");
  const count = await db.query<{ total: number }>(
    "select count(*)::int as total from dmcrm_card_payments where id=$1", [first.id],
  );
  assert.equal(count.rows[0].total, 1);
  for (const different of [
    { amount_cents: 20000 }, { payer_name: "Different Buyer" },
    { purpose: "Another invoice" }, { inventory_id: otherVehicle },
  ]) {
    await assert.rejects(reserve({ ...data, ...different }), /payment_retry_conflict/);
  }
  await assert.rejects(reserve({ ...draft(), employee_id: randomUUID() }), /payment_employee_denied/);
  await assert.rejects(reserve(draft(), otherOrg), /payment_employee_denied/);
  await assert.rejects(reserve({ ...draft(), inventory_id: otherVehicle }), /payment_inventory_missing/);
  await db.query("update dmcrm_inventory set stock_number='RENAMED' where id=$1", [vehicle]);
  try {
    assert.equal((await reserve(data)).stock_number, "DM101");
  } finally {
    await db.query("update dmcrm_inventory set stock_number='DM101' where id=$1", [vehicle]);
  }
});

test("synchronization binds a single Stripe intent and preserves the first verified receipt", async () => {
  const row = await reserve(draft());
  const intent = "pi_mockVerified";
  const processing = await sync(row, intent, "processing");
  assert.equal(processing.paid_at, null);
  assert.equal(processing.status, "processing");
  assert.deepEqual(await sync(row, intent, "pending"), processing);
  await assert.rejects(sync(processing, "pi_another", "processing"), /payment_intent_mismatch/);
  await assert.rejects(sync(processing, intent, "processing", { live: true }), /payment_intent_mismatch/);
  await assert.rejects(sync(processing, intent, "paid"), /check constraint/);
  const paidAt = "2026-11-24T15:30:01.000Z";
  const card = { paidAt, brand: "visa", last4: "4242" };
  await assert.rejects(sync(processing, intent, "paid", { ...card, orgId: otherOrg }), /no rows/);
  const paid = await sync(processing, intent, "paid", card);
  assert.equal(paid.status, "paid");
  assert.equal(new Date(paid.paid_at!).toISOString(), paidAt);
  assert.equal(paid.card_last4, "4242");
  assert.deepEqual(await sync(processing, intent, "paid", card), paid);
  assert.deepEqual(await sync(processing, intent, "processing"), paid);
  assert.deepEqual(await sync(paid, intent, "canceled"), paid);
  await assert.rejects(sync(await reserve(draft()), intent, "pending"), /unique constraint/);
});

test("declined and canceled attempts cannot carry a paid timestamp", async () => {
  const row = await reserve(draft());
  const intent = "pi_mockCanceled";
  const failed = await sync(row, intent, "pending");
  assert.equal(failed.paid_at, null);
  await assert.rejects(sync(failed, intent, "pending", { paidAt: new Date().toISOString() }), /check constraint/);
  const canceled = await sync(failed, intent, "canceled");
  assert.equal(canceled.paid_at, null);
  assert.deepEqual(await sync(failed, intent, "processing"), canceled);
});

test("browser-side Supabase roles cannot read the register or forge a paid entry", async () => {
  const reserveFunction = "dmcrm_reserve_card_payment(uuid,uuid,jsonb)";
  const syncFunction = "dmcrm_sync_card_payment(uuid,uuid,integer,text,text,boolean,timestamptz,text,text)";
  for (const role of ["anon", "authenticated", "service_role"]) {
    const result = await db.query<{ can_read: boolean; can_update: boolean; can_create: boolean; can_sync: boolean }>(
      `select has_table_privilege($1,'dmcrm_card_payments','SELECT') as can_read,
        has_table_privilege($1,'dmcrm_card_payments','UPDATE') as can_update,
        has_function_privilege($1,$2,'EXECUTE') as can_create,
        has_function_privilege($1,$3,'EXECUTE') as can_sync`,
      [role, reserveFunction, syncFunction],
    );
    const server = role === "service_role";
    assert.deepEqual(result.rows[0], { can_read: server, can_update: false, can_create: server, can_sync: server });
  }
});
