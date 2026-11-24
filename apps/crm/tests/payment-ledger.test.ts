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
const emptyOrg = randomUUID();
const depositActor = randomUUID();
const depositEmployee = randomUUID();
let db: PGlite;
let previousReceipt: Row;

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
  await db.query("insert into dmcrm_orgs values ($1)", [emptyOrg]);
  await db.query("insert into dmcrm_members values ($1,$2,'finance',true)", [emptyOrg, depositActor]);
  await db.query("insert into dmcrm_staff values ($1,$2,$3,'Deposit Cashier','finance',true)", [depositEmployee, emptyOrg, depositActor]);
  await db.exec(await readFile(new URL("../db/047_card_payments.sql", import.meta.url), "utf8"));
  const oldPayment = await reserve(previousSale);
  previousReceipt = await sync(oldPayment, "pi_existingReceipt", "paid", {
    paidAt: "2026-11-01T13:00:00.000Z", brand: "visa", last4: "1111",
  });
  await db.exec(await readFile(new URL("../db/048_manual_payment_stock.sql", import.meta.url), "utf8"));
});

after(async () => { await db?.close(); });

const draft = () => ({
  action: "create" as const, id: randomUUID(), employee_id: employee, inventory_id: vehicle,
  amount_cents: 12345, payer_name: "Example Buyer", purpose: "Vehicle deposit",
});

const previousSale = draft();

type Row = Payment & { revision: number; stripe_intent_id: string | null };

async function reserve(data: unknown, orgId: string = org, userId: string = actor) {
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

test("adding manual stock preserves a previously verified inventory receipt and its idempotency key", async () => {
  assert.deepEqual(await reserve(previousSale), previousReceipt);
  const { inventory_id, ...details } = previousSale;
  assert.equal(previousReceipt.inventory_id, inventory_id);
  await assert.rejects(reserve({ ...details, manual_stock_number: previousReceipt.stock_number }), /payment_retry_conflict/);
});

test("a deposit at a dealership with empty inventory retains its typed stock and receipt details", async () => {
  const { inventory_id: _inventoryId, ...details } = draft();
  const data = {
    ...details, employee_id: depositEmployee, manual_stock_number: " DEP-042 ",
    manual_vehicle_name: " Incoming Ford F-150 ",
  };
  const reserveDeposit = (input: unknown) => reserve(input, emptyOrg, depositActor);
  const [pending, retry] = await Promise.all([reserveDeposit(data), reserveDeposit(data)]);
  assert.deepEqual(retry, pending);
  assert.equal(pending.stock_number, "DEP-042");
  assert.equal(pending.vehicle_name, "Incoming Ford F-150");
  assert.equal(pending.inventory_id, null);
  assert.equal(pending.employee_id, depositEmployee);
  assert.equal(pending.paid_at, null);
  for (const change of [
    { manual_stock_number: "DEP-043" }, { manual_vehicle_name: "Different truck" }, { amount_cents: 9900 },
  ]) {
    await assert.rejects(reserveDeposit({ ...data, ...change }), /payment_retry_conflict/);
  }
  await assert.rejects(reserveDeposit({ ...data, employee_id: employee }), /payment_employee_denied/);
  await assert.rejects(reserve(data, otherOrg, depositActor), /payment_employee_denied/);
  const paid = await sync(pending, "pi_manualDeposit", "paid", {
    orgId: emptyOrg, paidAt: "2026-11-24T14:00:00.000Z", last4: "4444", brand: "mastercard",
  });
  assert.equal(paid.status, "paid");
  assert.equal(paid.amount_cents, data.amount_cents);
  assert.equal(paid.payer_name, data.payer_name);
  assert.equal(paid.stock_number, "DEP-042");
  assert.equal(paid.vehicle_name, "Incoming Ford F-150");
  assert.deepEqual(await reserveDeposit(data), paid);
  const stockOnly = { ...details, id: randomUUID(), manual_stock_number: "FUTURE-TRUCK", employee_id: depositEmployee };
  assert.equal((await reserveDeposit(stockOnly)).vehicle_name, "");
  const inventory = await db.query("select id from dmcrm_inventory where org_id=$1", [emptyOrg]);
  assert.equal(inventory.rows.length, 0);
});

test("the API requires either an inventory vehicle or a valid manual stock number", () => {
  const { inventory_id, ...details } = draft();
  for (const invalid of [
    {}, { manual_stock_number: "  " }, { manual_stock_number: "A".repeat(251) },
    { manual_vehicle_name: "Missing stock" }, { manual_stock_number: "001", manual_vehicle_name: "A".repeat(161) },
    { inventory_id, manual_stock_number: "001" }, { inventory_id, manual_vehicle_name: "Unverified description" },
  ]) {
    assert.equal(paymentCommandSchema.safeParse({ ...details, ...invalid }).success, false, JSON.stringify(invalid));
  }
});

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
