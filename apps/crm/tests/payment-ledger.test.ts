import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { paymentCommandSchema, type Payment } from "../lib/payments";
import { capture, paymentApi } from "./fixtures/payment-api";

const org = randomUUID();
const otherOrg = randomUUID();
const actor = randomUUID();
const employee = randomUUID();
const vehicle = randomUUID();
const otherVehicle = randomUUID();
const emptyOrg = randomUUID();
const depositActor = randomUUID();
const depositEmployee = randomUUID();
const cashier = { user_id: actor, staff_id: employee, org_id: org, name: "Test Employee", role: "sales" };
const manager = { ...cashier, user_id: randomUUID(), staff_id: randomUUID(), role: "manager" };
const finance = { ...cashier, user_id: randomUUID(), staff_id: randomUUID(), role: "finance" };
const otherCashier = { ...cashier, user_id: randomUUID(), staff_id: randomUUID() };
let db: PGlite;
let previousReceipt: Row;
let previousPending: Row;

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
  for (const staff of [manager, finance, otherCashier]) {
    await db.query("insert into dmcrm_members values ($1,$2,$3,true)", [org, staff.user_id, staff.role]);
    await db.query("insert into dmcrm_staff values ($1,$2,$3,'Other Employee',$4,true)",
      [staff.staff_id, org, staff.user_id, staff.role]);
  }
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
  const { inventory_id: _inventoryId, ...deposit } = draft();
  previousPending = await reserve({ ...deposit, manual_stock_number: "DEP-OLD", manual_vehicle_name: "Incoming vehicle" });
  await db.exec(await readFile(new URL("../db/049_manage_card_payments.sql", import.meta.url), "utf8"));
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
  assert.partialDeepStrictEqual(await reserve(previousSale), previousReceipt);
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
  const manageFunction = "dmcrm_manage_card_payment(uuid,uuid,uuid,text,uuid,integer)";
  for (const role of ["anon", "authenticated", "service_role"]) {
    const result = await db.query(
      `select has_table_privilege($1,'dmcrm_card_payments','SELECT') as can_read,
        has_table_privilege($1,'dmcrm_card_payments','UPDATE') as can_update,
        has_function_privilege($1,$2,'EXECUTE') as can_create,
        has_function_privilege($1,$3,'EXECUTE') as can_sync,
        has_function_privilege($1,$4,'EXECUTE') as can_manage`,
      [role, reserveFunction, syncFunction, manageFunction],
    );
    const server = role === "service_role";
    assert.deepEqual(result.rows[0], { can_read: server, can_update: false, can_create: server, can_sync: server, can_manage: server });
  }
});

const editAmount = (id: string, amount = 20000) => ({
  action: "edit_amount" as const, id, replacement_id: randomUUID(), amount_cents: amount,
});
const remove = (id: string) => ({ action: "delete" as const, id });

test("amount corrections validate cents and require a different, valid replacement ID", () => {
  const edit = editAmount(randomUUID());
  assert.ok(paymentCommandSchema.safeParse(edit).success);
  for (const change of [
    { amount_cents: 49 }, { amount_cents: 100000000 }, { amount_cents: 123.9 },
    { replacement_id: edit.id }, { replacement_id: "invalid" }, { employee_id: randomUUID() },
  ]) assert.equal(paymentCommandSchema.safeParse({ ...edit, ...change }).success, false);
  assert.equal(paymentCommandSchema.safeParse({ ...remove(edit.id), amount_cents: 100 }).success, false);
});

test("replacing a legacy manual-stock payment preserves the employee, stock and payer without duplicating the charge", async t => {
  const api = await paymentApi(t, db);
  const edit = editAmount(previousPending.id);
  const [first, retry] = await Promise.all([
    api.runPaymentCommand(manager, edit), api.runPaymentCommand(manager, edit),
  ]);
  assert.deepEqual(retry.payment, first.payment);
  const payment = first.payment;
  assert.equal(payment.id, edit.replacement_id);
  assert.equal(payment.amount_cents, edit.amount_cents);
  assert.equal(payment.status, "pending");
  for (const key of ["payer_name", "purpose", "employee_id", "employee_name", "stock_number", "inventory_id", "vehicle_name"] as const)
    assert.equal(payment[key], previousPending[key]);
  assert.equal(await api.getScopedPayment(cashier, previousPending.id), null);
  const list = await api.listPayments(cashier, 0);
  assert.ok(list.payments.some(p => p.id === payment.id));
  assert.ok(!list.payments.some(p => p.id === previousPending.id));
  await assert.rejects(api.runPaymentCommand(manager, remove(previousPending.id)), { status: 409 });
  await assert.rejects(api.runPaymentCommand(manager, { ...edit, amount_cents: edit.amount_cents + 1 }), { status: 409 });
  await assert.rejects(api.runPaymentCommand(manager, editAmount(previousPending.id)), { status: 409 });
  // A pre-migration creation request was in flight when the row was archived.
  await assert.rejects(sync(previousPending, "pi_lateBinding", "pending"), /payment_archived/);
  const stale = await db.query("select stripe_intent_id,amount_cents from dmcrm_card_payments where id=$1", [previousPending.id]);
  assert.deepEqual(stale.rows[0], { stripe_intent_id: null, amount_cents: previousPending.amount_cents });
  const resumed = await api.runPaymentCommand(cashier, { action: "resume", id: payment.id });
  assert.ok(resumed.client_secret);
  assert.equal(api.intents.size, 1);
  assert.equal([...api.intents.values()][0].amount, edit.amount_cents);
});

test("Stripe cancellation retires the old client secret before editing or deleting a bound payment", async t => {
  const api = await paymentApi(t, db);
  const data = draft();
  const created = await api.runPaymentCommand(cashier, data);
  assert.ok(created.client_secret);
  const original = [...api.intents.values()][0];
  const edit = editAmount(data.id);
  api.failCancellation(true);
  await assert.rejects(api.runPaymentCommand(cashier, edit));
  assert.equal((await api.getScopedPayment(cashier, data.id))?.amount_cents, data.amount_cents);
  assert.equal(await api.getScopedPayment(cashier, edit.replacement_id), null);
  api.failCancellation(false);
  api.beforeManageWrite(async () => { throw new Error("Simulated write interruption"); });
  await assert.rejects(api.runPaymentCommand(cashier, edit));
  assert.equal(original.status, "canceled");
  assert.equal(await api.getScopedPayment(cashier, edit.replacement_id), null);
  const changed = await api.runPaymentCommand(cashier, edit);
  assert.equal(original.status, "canceled");
  assert.throws(() => capture(original));
  assert.equal(changed.payment.amount_cents, edit.amount_cents);
  assert.equal((await api.runPaymentCommand(cashier, edit)).payment.id, changed.payment.id);
  await assert.rejects(api.runPaymentCommand(cashier, { action: "resume", id: data.id }), { status: 404 });
  await assert.rejects(api.runPaymentCommand(cashier, { action: "verify", id: data.id }), { status: 404 });
  await api.reconcileStripeWebhook(org, data.id, original.id);
  assert.equal(await api.getScopedPayment(cashier, data.id), null);
  const resumed = await api.runPaymentCommand(cashier, { action: "resume", id: changed.payment.id });
  assert.ok(resumed.client_secret);
  assert.notEqual(resumed.client_secret, created.client_secret);
  assert.equal(api.intents.size, 2);
  const replacement = [...api.intents.values()].find(i => i.metadata.dmcrm_payment_id === changed.payment.id)!;
  assert.equal(replacement.amount, edit.amount_cents);
  const beforeDelete = await api.listPayments(cashier, 0);
  const deletion = remove(changed.payment.id);
  const result = await api.runPaymentCommand(manager, deletion);
  assert.equal(result.deleted, true);
  assert.equal(replacement.status, "canceled");
  assert.equal((await api.runPaymentCommand(manager, deletion)).deleted, true);
  assert.equal(await api.getScopedPayment(cashier, changed.payment.id), null);
  const afterDelete = await api.listPayments(cashier, 0);
  assert.equal(afterDelete.total, beforeDelete.total - 1);
  assert.ok(!afterDelete.payments.some(p => p.id === changed.payment.id));
  await assert.rejects(api.runPaymentCommand(cashier, edit), { status: 409 });
  // Delayed create retries must not restart the retired checkout.
  await assert.rejects(api.runPaymentCommand(cashier, data), { status: 404 });
  assert.equal(api.intents.size, 2);
});

test("declined card attempts and provider-canceled attempts can each be edited or removed", async t => {
  const api = await paymentApi(t, db);
  for (const status of ["failed", "canceled"] as const) {
    for (const mutation of [editAmount, remove]) {
      const data = draft();
      await api.runPaymentCommand(cashier, data);
      const intent = [...api.intents.values()].find(i => i.metadata.dmcrm_payment_id === data.id)!;
      if (status === "failed") Object.assign(intent, { last_payment_error: { code: "card_declined" } });
      else intent.status = "canceled";
      const verified = await api.runPaymentCommand(cashier, { action: "verify", id: data.id });
      assert.equal(verified.payment.status, status);
      const command = mutation(data.id);
      const result = await api.runPaymentCommand(cashier, command);
      if ("replacement_id" in command) assert.equal(result.payment.id, command.replacement_id);
      else assert.equal(result.deleted, true);
      assert.equal(intent.status, "canceled");
      assert.equal(await api.getScopedPayment(cashier, data.id), null);
    }
  }
});

test("a capture that wins the cancellation race keeps its full verified receipt and amount for both actions", async t => {
  const api = await paymentApi(t, db);
  for (const mutation of [editAmount, remove]) {
    const data = draft();
    await api.runPaymentCommand(cashier, data);
    api.beforeCancel(capture);
    const command = mutation(data.id);
    await assert.rejects(api.runPaymentCommand(cashier, command));
    const paid = await api.getScopedPayment(cashier, data.id);
    assert.equal(paid?.status, "paid");
    assert.equal(paid.amount_cents, data.amount_cents);
    assert.equal(paid.card_last4, "4242");
    assert.ok(paid.paid_at);
    await assert.rejects(api.runPaymentCommand(manager, command));
    assert.deepEqual(await api.getScopedPayment(cashier, data.id), paid);
    if ("replacement_id" in command) assert.equal(await api.getScopedPayment(cashier, command.replacement_id), null);
  }
  assert.equal(api.cancelAttempts.length, 2);
});

test("processing and authorized intents stay untouched, and mutations are scoped to the employee or dealership manager", async t => {
  const api = await paymentApi(t, db);
  const data = draft();
  await api.runPaymentCommand(cashier, data);
  const intent = [...api.intents.values()][0];
  for (const command of [editAmount(data.id), remove(data.id)]) {
    for (const staff of [finance, otherCashier, { ...manager, org_id: otherOrg }]) {
      await assert.rejects(api.runPaymentCommand(staff, command), (error: { status?: number }) => [403, 404].includes(error.status ?? 0));
    }
    assert.equal(api.cancelAttempts.length, 0);
  }
  for (const status of ["requires_capture", "processing"] as const) {
    intent.status = status;
    for (const command of [remove(data.id), editAmount(data.id)]) {
      await assert.rejects(api.runPaymentCommand(cashier, command));
      assert.equal((await api.getScopedPayment(cashier, data.id))?.amount_cents, data.amount_cents);
    }
  }
  assert.equal(api.cancelAttempts.length, 0);
  assert.ok((await api.listPayments(cashier, 0)).payments.some(p => p.id === data.id));
});

test("a first card-entry request that binds while the employee deletes a draft must be canceled", async t => {
  const api = await paymentApi(t, db);
  const data = draft();
  await reserve(data);
  api.beforeManageWrite(async () => {
    assert.ok((await api.runPaymentCommand(cashier, { action: "resume", id: data.id })).client_secret);
  });
  assert.equal((await api.runPaymentCommand(cashier, remove(data.id))).deleted, true);
  const [intent] = api.intents.values();
  assert.deepEqual(api.cancelAttempts, [intent.id]);
  assert.equal(intent.status, "canceled");
  assert.equal(await api.getScopedPayment(cashier, data.id), null);
});

test("the management RPC checks the acting membership, binding and terminal status under the row lock", async () => {
  const pending = await reserve(draft());
  const bound = await sync(pending, "pi_bindingWinner", "pending");
  const manage = (orgId: string, userId: string, intent: string | null) => db.query(
    "select dmcrm_manage_card_payment($1,$2,$3,$4,null,null)", [orgId, userId, bound.id, intent]);
  for (const staff of [finance, otherCashier])
    await assert.rejects(manage(org, staff.user_id, bound.stripe_intent_id), /payment_employee_denied/);
  await assert.rejects(manage(emptyOrg, depositActor, bound.stripe_intent_id), /payment_missing/);
  await assert.rejects(manage(org, actor, null), /payment_binding_changed/);
  await assert.rejects(manage(org, actor, bound.stripe_intent_id), /payment_not_editable/);
  const paid = await sync(bound, bound.stripe_intent_id!, "paid", { paidAt: "2026-11-24T13:00:00Z" });
  await assert.rejects(manage(org, manager.user_id, bound.stripe_intent_id), /payment_not_editable/);
  const saved = await db.query("select to_jsonb(p) as payment from dmcrm_card_payments p where id=$1", [bound.id]);
  assert.deepEqual(saved.rows[0], { payment: paid });
});

test("deleting the last entry on a register page returns staff to the populated first page", async t => {
  const api = await paymentApi(t, db);
  const register = { ...cashier, org_id: randomUUID() };
  await db.query("insert into dmcrm_orgs values ($1)", [register.org_id]);
  await db.query("insert into dmcrm_members values ($1,$2,'sales',true)", [register.org_id, actor]);
  await db.query("insert into dmcrm_staff values ($1,$2,$3,'Register Employee','sales',true)", [employee, register.org_id, actor]);
  const { inventory_id: _inventoryId, ...data } = draft();
  for (let i = 0; i < 26; i++)
    await reserve({ ...data, id: randomUUID(), manual_stock_number: "REG-" + i }, register.org_id, actor);
  const second = await api.listPayments(register, 1);
  assert.equal(second.payments.length, 1);
  assert.equal(second.total, 26);
  const id = second.payments[0].id;
  await api.runPaymentCommand(register, remove(id));
  const afterDelete = await api.listPayments(register, 1);
  assert.equal(afterDelete.page, 0);
  assert.equal(afterDelete.total, 25);
  assert.equal(afterDelete.payments.length, 25);
  assert.ok(!afterDelete.payments.some(p => p.id === id));
});
