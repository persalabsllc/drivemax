import { z } from "zod";
import {
  inventorySchema,
  vehicleDetailsSchema,
  tradeSchema,
  inventorySnapshot,
  vehicleName,
  type InventoryVehicle,
  type VehicleDetails,
  type Trade,
} from "./vehicles";
export type { InventoryVehicle, VehicleDetails, Trade } from "./vehicles";

export type Customer = {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: "new" | "working" | "appointment" | "sold" | "lost";
  vehicle_interest: string;
  trade_vehicle: string;
  inventory_id?: string | null;
  vehicle_details?: VehicleDetails | null;
  trade?: Trade | null;
  birthday: string | null;
  sold_on: string | null;
  created_at: string;
  updated_at: string;
};
export type Visit = {
  id: string;
  org_id: string;
  customer_id: string;
  arrived_at: string;
  departed_at: string | null;
  outcome: "browsing" | "unsold" | "sold";
};
export type Activity = {
  id: string;
  org_id: string;
  customer_id: string;
  kind: "note" | "call" | "system";
  body: string;
  created_at: string;
  created_by: string;
};
export type Task = {
  id: string;
  org_id: string;
  customer_id: string | null;
  title: string;
  due_date: string;
  kind:
    | "appointment"
    | "unsold_followup"
    | "sold_followup"
    | "birthday"
    | "anniversary"
    | "task";
  completed_at: string | null;
  canceled_at: string | null;
};
export type QuoteValues = {
  price: number;
  docFee: number;
  tax: number;
  titleFee: number;
  tradeAllowance: number;
  payoff: number;
  downPayment: number;
  apr: number;
  months: number;
  acv: number;
  recon: number;
};
export type Quote = {
  id: string;
  org_id: string;
  customer_id: string;
  vehicle: string;
  values: QuoteValues;
  created_at: string;
  inventory_id?: string | null;
  vehicle_details?: VehicleDetails | null;
  trade_snapshot?: Trade | null;
  trade_input?: Trade | null;
  snapshot_version?: number;
};
export type Workspace = {
  org: { id: string; name: string; slug: string };
  member: { id: string; name: string; role: string };
  customers: Customer[];
  inventory: InventoryVehicle[];
  visits: Visit[];
  activities: Activity[];
  tasks: Task[];
  quotes: Quote[];
};
export const TODAY_TZ = "America/New_York";
export function dayKey(date: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TODAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function nextAnniversary(date: string, today: string) {
  const md = date.slice(5);
  let year = Number(today.slice(0, 4));
  let out = year + "-" + md;
  if (out < today) out = ++year + "-" + md;
  if (md === "02-29" && new Date(out + "T12:00:00Z").getUTCMonth() !== 1)
    out = year + "-02-28";
  return out;
}
export function addMonths(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const fullMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
export const defaultQuote: QuoteValues = {
  price: 0,
  docFee: 399,
  tax: 0,
  titleFee: 0,
  tradeAllowance: 0,
  payoff: 0,
  downPayment: 0,
  apr: 9.99,
  months: 60,
  acv: 0,
  recon: 0,
};
export function quoteMath(v: QuoteValues) {
  const total =
    Math.round(
      (v.price + v.docFee + v.tax + v.titleFee - v.tradeAllowance + v.payoff) *
        100,
    ) / 100;
  const balance = Math.round((total - v.downPayment) * 100) / 100;
  const rate = v.apr / 1200;
  const months = Math.max(1, v.months);
  const payment =
    balance > 0
      ? rate
        ? (balance * rate) / (1 - Math.pow(1 + rate, -months))
        : balance / months
      : 0;
  return { total, balance, payment: Math.round(payment * 100) / 100 };
}
const text = z.string().trim().max(250);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v + "T12:00:00Z")) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const birthday = z
  .union([date, z.literal("")])
  .transform((v) => v || null)
  .nullable();
const customer = {
  name: text.min(2),
  email: z.union([z.email().max(250), z.literal("")]),
  phone: z.string().trim().max(30),
  source: text,
  status: z.enum(["new", "working", "appointment", "sold", "lost"]),
  vehicle_interest: text,
  trade_vehicle: text,
  birthday,
  inventory_id: z.uuid().nullable().optional(),
  vehicle_details: vehicleDetailsSchema.nullable().optional(),
  trade: tradeSchema.nullable().optional(),
};
const amount = z.number().finite().min(0).max(1000000);
export const quoteSchema = z.object({
  price: amount,
  docFee: amount,
  tax: amount,
  titleFee: amount,
  tradeAllowance: amount,
  payoff: amount,
  downPayment: amount,
  apr: z.number().min(0).max(50),
  months: z.number().int().min(1).max(120),
  acv: amount,
  recon: amount,
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("save_inventory"),
    id: z.uuid().optional(),
    vehicle: inventorySchema,
  }),
  z.object({
    type: z.literal("create_customer"),
    customer: z.object(customer),
  }),
  z.object({
    type: z.literal("update_customer"),
    id: z.uuid(),
    customer: z.object(customer),
  }),
  z.object({
    type: z.literal("add_activity"),
    customer_id: z.uuid(),
    kind: z.enum(["note", "call"]),
    body: z.string().trim().min(1).max(8000),
  }),
  z.object({ type: z.literal("check_in"), customer_id: z.uuid() }),
  z.object({ type: z.literal("check_out"), id: z.uuid() }),
  z.object({ type: z.literal("mark_sold"), customer_id: z.uuid() }),
  z.object({
    type: z.literal("create_task"),
    customer_id: z.uuid().nullable(),
    title: text.min(2),
    due_date: date,
    kind: z.enum(["appointment", "unsold_followup", "sold_followup", "task"]),
  }),
  z.object({ type: z.literal("complete_task"), id: z.uuid() }),
  z.object({
    type: z.literal("save_quote"),
    customer_id: z.uuid(),
    vehicle: text.min(1),
    values: quoteSchema,
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const isOpenTask = (t: Task) => !t.completed_at && !t.canceled_at;

// The demo runs only in memory. This reducer never touches the live workspace.
export function demoCommand(
  ws: Workspace,
  command: Command,
  now = new Date(),
): Workspace {
  const s = structuredClone(ws),
    p = commandSchema.parse(command),
    stamp = now.toISOString(),
    today = dayKey(now),
    id = () => crypto.randomUUID(),
    org_id = s.org.id;
  const activity = (
    customer_id: string,
    body: string,
    kind: Activity["kind"] = "system",
  ) =>
    s.activities.unshift({
      id: id(),
      org_id,
      customer_id,
      body,
      kind,
      created_at: stamp,
      created_by: s.member.name,
    });
  const task = (
    customer_id: string,
    title: string,
    due_date: string,
    kind: Task["kind"],
  ) =>
    s.tasks.push({
      id: id(),
      org_id,
      customer_id,
      title,
      due_date,
      kind,
      completed_at: null,
      canceled_at: null,
    });
  if (p.type === "save_inventory") {
    if (
      s.inventory.some(
        (v) =>
          v.id !== p.id &&
          (v.vin === p.vehicle.vin ||
            v.stock_number.toLowerCase() ===
              p.vehicle.stock_number.toLowerCase()),
      )
    )
      throw new Error("That VIN or stock number already exists in inventory.");
    if (p.id) {
      const v = s.inventory.find((v) => v.id === p.id);
      if (!v) throw new Error("Vehicle unavailable");
      Object.assign(v, p.vehicle, { updated_at: stamp });
    } else {
      s.inventory.unshift({
        ...p.vehicle,
        id: id(),
        org_id,
        created_at: stamp,
        updated_at: stamp,
      });
    }
  }
  if (p.type === "create_customer" || p.type === "update_customer") {
    if (p.customer.inventory_id) {
      const v = s.inventory.find((v) => v.id === p.customer.inventory_id);
      if (!v) throw new Error("Vehicle unavailable");
      if (
        v.status !== "in_stock" &&
        !(
          p.type === "update_customer" &&
          s.customers.find((c) => c.id === p.id)?.inventory_id === v.id
        )
      )
        throw new Error("Select an in-stock vehicle");
      p.customer.vehicle_interest = vehicleName(v);
      p.customer.vehicle_details = inventorySnapshot(v);
    }
    if (p.customer.trade)
      p.customer.trade_vehicle =
        p.customer.trade.description ||
        vehicleName(p.customer.trade) ||
        p.customer.trade.vin;
  }
  if (p.type === "create_customer") {
    const c = {
      ...p.customer,
      id: id(),
      org_id,
      sold_on: null,
      created_at: stamp,
      updated_at: stamp,
    };
    s.customers.unshift(c);
    activity(c.id, "Customer profile created");
    task(
      c.id,
      "Follow up with " + c.name,
      addDays(today, 1),
      "unsold_followup",
    );
    if (c.birthday)
      task(
        c.id,
        c.name + " · birthday",
        nextAnniversary(c.birthday, today),
        "birthday",
      );
  }
  if (p.type === "update_customer") {
    const c = s.customers.find((c) => c.id === p.id);
    if (c) Object.assign(c, p.customer, { updated_at: stamp });
  }
  if (p.type === "add_activity") activity(p.customer_id, p.body, p.kind);
  if (
    p.type === "check_in" &&
    !s.visits.some((v) => v.customer_id === p.customer_id && !v.departed_at)
  ) {
    s.visits.unshift({
      id: id(),
      org_id,
      customer_id: p.customer_id,
      arrived_at: stamp,
      departed_at: null,
      outcome: "browsing",
    });
    activity(p.customer_id, "Checked into the showroom");
  }
  if (p.type === "check_out") {
    const v = s.visits.find((v) => v.id === p.id);
    if (v && !v.departed_at) {
      v.departed_at = stamp;
      if (v.outcome !== "sold") {
        v.outcome = "unsold";
        task(
          v.customer_id,
          "Follow up after showroom visit",
          addDays(today, 1),
          "unsold_followup",
        );
      }
      activity(v.customer_id, "Checked out of the showroom");
    }
  }
  if (p.type === "mark_sold") {
    const c = s.customers.find((c) => c.id === p.customer_id);
    if (c && c.status !== "sold") {
      c.status = "sold";
      c.sold_on = today;
      const iv = s.inventory.find((v) => v.id === c.inventory_id);
      if (iv) iv.status = "sold";
      s.visits
        .filter(
          (v) =>
            v.customer_id === c.id &&
            (!v.departed_at ||
              v.id ===
                s.visits
                  .filter(
                    (x) =>
                      x.customer_id === c.id && dayKey(x.arrived_at) === today,
                  )
                  .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at))[0]
                  ?.id),
        )
        .forEach((v) => (v.outcome = "sold"));
      s.tasks
        .filter(
          (t) =>
            t.customer_id === c.id &&
            t.kind === "unsold_followup" &&
            isOpenTask(t),
        )
        .forEach((t) => (t.canceled_at = stamp));
      for (const d of [2, 7, 30])
        task(
          c.id,
          d + "-day sold follow-up",
          addDays(today, d),
          "sold_followup",
        );
      task(
        c.id,
        "Purchase anniversary",
        nextAnniversary(today, addDays(today, 1)),
        "anniversary",
      );
      activity(c.id, "Deal marked sold");
    }
  }
  if (p.type === "create_task")
    s.tasks.push({
      ...p,
      id: id(),
      org_id,
      completed_at: null,
      canceled_at: null,
    });
  if (p.type === "complete_task") {
    const t = s.tasks.find((t) => t.id === p.id);
    if (t && isOpenTask(t)) {
      t.completed_at = stamp;
      if (t.customer_id && ["birthday", "anniversary"].includes(t.kind))
        task(
          t.customer_id,
          t.title,
          nextAnniversary(t.due_date, addDays(t.due_date, 1)),
          t.kind,
        );
    }
  }
  if (p.type === "save_quote") {
    const c = s.customers.find((c) => c.id === p.customer_id),
      v = s.inventory.find((v) => v.id === c?.inventory_id);
    s.quotes.unshift({
      id: id(),
      org_id,
      customer_id: p.customer_id,
      vehicle: p.vehicle,
      values: p.values,
      created_at: stamp,
      inventory_id: c?.inventory_id ?? null,
      vehicle_details: v ? inventorySnapshot(v) : (c?.vehicle_details ?? null),
      trade_input: c?.trade ?? null,
      snapshot_version: 1,
      trade_snapshot: c?.trade
        ? {
            ...c.trade,
            allowance: p.values.tradeAllowance,
            acv: p.values.acv,
            payoff: p.values.payoff,
          }
        : null,
    });
  }
  return s;
}
