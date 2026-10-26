import { z } from "zod";
import {
  buyerSchema,
  coBuyerSchema,
  insuranceSchema,
  type Person,
  type Insurance,
} from "./people";
import { calculateQuote, type FinanceValues } from "./finance";
import {
  operationCommands,
  productSchema,
  type Sale,
  type TradeIntake,
  type Commission,
  type Message,
} from "./operations";
import { demoOperations } from "./operations-demo";
import {
  appointmentCommands,
  newCustomerAppointmentSchema,
  type Appointment,
} from "./appointments";
import { demoAppointments } from "./appointments-demo";
import { demoQuickQuote } from "./quick-quote";
import { fiMenuSchema, fiSelectionMatches } from "./fi-menu";
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
  assigned_to?: string | null;
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
  person?: Person | null;
  co_buyer?: Person | null;
  insurance?: Insurance | null;
  birthday: string | null;
  sold_on: string | null;
  created_at: string;
  updated_at: string;
};
export type Opportunity = {
  assigned_to?: string | null;
  id: string;
  org_id: string;
  customer_id: string;
  title: string;
  status: Customer["status"];
  source: string;
  inventory_id: string | null;
  vehicle_interest: string;
  vehicle_details: VehicleDetails | null;
  trade_vehicle: string;
  trade: Trade | null;
  sold_on: string | null;
  lost_reason: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  sale_snapshot: {
    customer: Customer;
    quote: Quote | null;
    insurance: Insurance | null;
    salesperson?: { id: string; name: string } | null;
  } | null;
  paperwork: Record<string, Record<string, string | boolean>>;
  paperwork_revision: number;
};
export const opportunityOpen = (o: Opportunity) =>
  o.status !== "sold" && o.status !== "lost";
export function opportunityCustomer(
  c: Customer,
  o: Opportunity,
  inventory: InventoryVehicle[] = [],
): Customer {
  const base = o.sale_snapshot?.customer ?? c;
  return {
    ...base,
    id: c.id,
    org_id: c.org_id,
    status: o.status,
    sold_on: o.sold_on,
    vehicle_interest: o.vehicle_interest,
    inventory_id: o.inventory_id,
    vehicle_details: o.vehicle_details,
    trade_vehicle: o.trade_vehicle,
    trade: o.trade,
    updated_at: o.updated_at,
  };
}
export type Visit = {
  opportunity_id?: string | null;
  id: string;
  org_id: string;
  customer_id: string;
  arrived_at: string;
  departed_at: string | null;
  outcome: "browsing" | "unsold" | "sold";
};
export type Activity = {
  opportunity_id?: string | null;
  id: string;
  org_id: string;
  customer_id: string;
  kind: "note" | "call" | "system" | "email" | "sms";
  body: string;
  created_at: string;
  created_by: string;
};
export type Task = {
  channel?: "call" | "email" | "sms" | "task";
  assigned_to?: string | null;
  opportunity_id?: string | null;
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
export type QuoteValues = FinanceValues;
export type Quote = {
  opportunity_id?: string | null;
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
export type PrintableQuote = Pick<
  Quote,
  | "vehicle"
  | "values"
  | "created_at"
  | "vehicle_details"
  | "trade_snapshot"
  | "snapshot_version"
>;
export type Staff = {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: "owner" | "manager" | "sales";
  active: boolean;
  created_at: string;
};
export const canManage = (role: string) =>
  role === "owner" || role === "manager";
export type Workspace = {
  /** In-memory retry keys used only by the demo; live conversions stay server-side. */
  quick_quote_conversions?: Record<
    string,
    { customer_id: string; opportunity_id: string }
  >;
  appointments?: Appointment[];
  sales?: Sale[];
  trades?: TradeIntake[];
  commissions?: Commission[];
  messages?: Message[];
  org: { id: string; name: string; slug: string };
  member: { id: string; name: string; role: string; staff_id?: string };
  staff: Staff[];
  customers: Customer[];
  opportunities: Opportunity[];
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
export const quoteMath = calculateQuote;
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
  person: buyerSchema.nullable().optional(),
  co_buyer: coBuyerSchema.nullable().optional(),
  initial_opportunity: z.boolean().optional(),
  inventory_id: z.uuid().nullable().optional(),
  vehicle_details: vehicleDetailsSchema.nullable().optional(),
  trade: tradeSchema.nullable().optional(),
};
const amount = z.number().finite().min(0).max(1000000);
export const quoteSchema = z
  .object({
    fiMenu: fiMenuSchema.optional(),
    products: z.array(productSchema).max(30).optional(),
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
    mode: z.enum(["cash", "finance"]).optional(),
    taxMode: z.enum(["auto", "manual"]).optional(),
    taxReason: z.string().max(500).optional(),
    addOns: amount.optional(),
    serviceContract: amount.optional(),
    otherTaxes: amount.optional(),
    daysToFirstPayment: z.number().int().min(30).max(120).optional(),
    financeOptions: z
      .array(
        z.object({
          months: z.number().int().min(1).max(120),
          apr: z.number().min(0).max(50),
        }),
      )
      .length(3)
      .optional(),
    downPayments: z.array(amount).length(3).optional(),
    selectedOption: z.number().int().min(0).max(2).optional(),
    selectedDown: z.number().int().min(0).max(2).optional(),
  })
  .refine(
    (values) =>
      !values.fiMenu ||
      values.fiMenu.selected === null ||
      fiSelectionMatches(values),
    "The selected F&I package does not match the deal products. Apply the package again.",
  );
export const quickQuoteSchema = z.object({
  inventory_id: z.uuid().nullable(),
  vehicle: text,
  values: quoteSchema,
});
export type QuickQuoteInput = z.infer<typeof quickQuoteSchema>;
export const opportunitySchema = z.object({
  assigned_to: z.uuid().nullable().optional(),
  title: text.min(1),
  source: text,
  status: z.enum(["new", "working", "appointment"]),
  inventory_id: z.uuid().nullable(),
  vehicle_interest: text,
  vehicle_details: vehicleDetailsSchema.nullable(),
  trade_vehicle: text,
  trade: tradeSchema.nullable(),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("convert_quick_quote"),
    id: z.uuid(),
    customer: z.object(customer),
    quote: quickQuoteSchema,
  }),
  ...appointmentCommands,
  ...operationCommands,
  z.object({
    type: z.literal("save_staff"),
    id: z.uuid().optional(),
    staff: z.object({
      name: z.string().trim().min(2).max(120),
      email: z
        .email()
        .max(250)
        .transform((v) => v.trim().toLowerCase()),
      role: z.enum(["sales", "manager"]),
    }),
  }),
  z.object({
    type: z.literal("set_staff_active"),
    id: z.uuid(),
    active: z.boolean(),
    reassign_to: z.uuid().optional(),
  }),
  z.object({
    type: z.literal("assign_opportunity"),
    id: z.uuid(),
    assigned_to: z.uuid().nullable(),
  }),
  z.object({
    type: z.literal("create_opportunity"),
    customer_id: z.uuid(),
    opportunity: opportunitySchema,
  }),
  z.object({
    type: z.literal("update_opportunity"),
    id: z.uuid(),
    opportunity: opportunitySchema,
  }),
  z.object({
    type: z.literal("close_opportunity"),
    id: z.uuid(),
    outcome: z.enum(["sold", "lost"]),
    reason: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("save_insurance"),
    customer_id: z.uuid(),
    insurance: insuranceSchema,
  }),
  z.object({
    type: z.literal("save_paperwork"),
    opportunity_id: z.uuid(),
    revision: z.number().int().min(0),
    paperwork: z.record(
      z.string().max(80),
      z.record(
        z.string().max(250),
        z.union([z.string().max(8000), z.boolean()]),
      ),
    ),
  }),
  z.object({
    type: z.literal("save_inventory"),
    id: z.uuid().optional(),
    vehicle: inventorySchema,
  }),
  z.object({
    type: z.literal("create_customer"),
    customer: z.object(customer),
    appointment: newCustomerAppointmentSchema.optional(),
  }),
  z.object({
    type: z.literal("update_customer"),
    id: z.uuid(),
    customer: z.object(customer),
  }),
  z.object({
    type: z.literal("add_activity"),
    customer_id: z.uuid(),
    opportunity_id: z.uuid().nullable().optional(),
    kind: z.enum(["note", "call", "email", "sms"]),
    body: z.string().trim().min(1).max(8000),
  }),
  z.object({
    type: z.literal("check_in"),
    customer_id: z.uuid(),
    opportunity_id: z.uuid().nullable().optional(),
  }),
  z.object({ type: z.literal("check_out"), id: z.uuid() }),
  z.object({ type: z.literal("mark_sold"), customer_id: z.uuid() }),
  z.object({
    type: z.literal("create_task"),
    channel: z.enum(["call", "email", "sms", "task"]).optional(),
    assigned_to: z.uuid().nullable().optional(),
    opportunity_id: z.uuid().nullable().optional(),
    customer_id: z.uuid().nullable(),
    title: text.min(2),
    due_date: date,
    kind: z.enum(["appointment", "unsold_followup", "sold_followup", "task"]),
  }),
  z.object({ type: z.literal("complete_task"), id: z.uuid() }),
  z.object({
    type: z.literal("save_quote"),
    opportunity_id: z.uuid().optional(),
    customer_id: z.uuid(),
    vehicle: text.min(1),
    values: quoteSchema,
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const isOpenTask = (t: Task) => !t.completed_at && !t.canceled_at;
export const myStaffId = (ws: Workspace) =>
  ws.member.staff_id ?? ws.staff.find((s) => s.user_id === ws.member.id)?.id;
export const visibleTasks = (ws: Workspace) =>
  canManage(ws.member.role)
    ? ws.tasks
    : ws.tasks.filter((t) => t.assigned_to === myStaffId(ws));

// Demo uses the same command contracts; it never writes live records.
export function demoCommand(
  ws: Workspace,
  command: Command,
  now = new Date(),
): Workspace {
  const parsed = commandSchema.parse(command);
  if (
    parsed.type === "mark_sold" ||
    (parsed.type === "close_opportunity" && parsed.outcome === "sold")
  ) {
    const op = ws.opportunities.find((o) =>
      parsed.type === "mark_sold"
        ? o.customer_id === parsed.customer_id && opportunityOpen(o)
        : o.id === parsed.id,
    );
    if (
      op &&
      !op.trade &&
      Object.values(ws.quick_quote_conversions ?? {}).some(
        (c) => c.opportunity_id === op.id,
      )
    ) {
      const values = ws.quotes.find(
        (q) =>
          q.opportunity_id === op.id &&
          (q.inventory_id ?? null) === op.inventory_id &&
          (op.inventory_id || q.vehicle === op.vehicle_interest),
      )?.values;
      if (
        op.trade_vehicle ||
        values?.tradeAllowance ||
        values?.payoff ||
        values?.acv ||
        values?.recon
      )
        throw Error(
          "Complete the trade vehicle details or remove the trade before marking this deal sold.",
        );
    }
  }
  if (parsed.type === "convert_quick_quote") {
    return demoQuickQuote(ws, parsed, now, demoCommand);
  }
  return demoAppointments(ws, parsed, now, (input, p, time) =>
    demoOperations(input, p, time, baseDemoCommand),
  );
}
function baseDemoCommand(
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
  const manager = canManage(s.member.role),
    me = myStaffId(s);
  const requireManager = () => {
    if (!manager) throw Error("Manager access required");
  };
  const validAssignee = (value: string | null | undefined) => {
    if (value && !s.staff.some((m) => m.id === value && m.active))
      throw Error("Select an active team member");
    return value ?? null;
  };
  const taskAssignee = (cid?: string | null, oid?: string | null) =>
    oid
      ? (s.opportunities.find((o) => o.id === oid)?.assigned_to ?? null)
      : cid
        ? (s.customers.find((c) => c.id === cid)?.assigned_to ?? null)
        : (me ?? null);
  const assign = (o: Opportunity, who: string | null) => {
    o.assigned_to = validAssignee(who);
    s.tasks
      .filter((t) => t.opportunity_id === o.id && isOpenTask(t))
      .forEach((t) => (t.assigned_to = who));
    const later = s.opportunities.some(
      (x) =>
        x.customer_id === o.customer_id &&
        opportunityOpen(x) &&
        (x.created_at > o.created_at ||
          (x.created_at === o.created_at && x.id > o.id)),
    );
    if (
      !later &&
      (opportunityOpen(o) ||
        !s.opportunities.some(
          (x) => x.customer_id === o.customer_id && opportunityOpen(x),
        ))
    ) {
      const c = s.customers.find((c) => c.id === o.customer_id)!;
      s.tasks
        .filter(
          (t) =>
            t.customer_id === c.id &&
            !t.opportunity_id &&
            t.assigned_to === c.assigned_to &&
            isOpenTask(t),
        )
        .forEach((t) => (t.assigned_to = who));
      c.assigned_to = who;
    }
  };
  if (p.type === "save_staff" || p.type === "set_staff_active") {
    requireManager();
    const old = s.staff.find((m) => m.id === p.id);
    if (p.id && !old) throw Error("Team member unavailable");
    if (
      old &&
      (old.role === "owner" ||
        old.id === me ||
        (s.member.role === "manager" && old.role !== "sales"))
    )
      throw Error(
        "Owner access is protected; only the owner can manage managers",
      );
    if (p.type === "save_staff") {
      if (p.staff.role === "manager" && s.member.role !== "owner")
        throw Error("Only the owner can add managers");
      if (
        s.staff.some(
          (m) => m.id !== p.id && m.email.toLowerCase() === p.staff.email,
        )
      )
        throw Error("That email is already on your team");
      if (old?.user_id && old.email !== p.staff.email)
        throw Error("Login email cannot be changed here");
      if (old) Object.assign(old, p.staff);
      else
        s.staff.unshift({
          ...p.staff,
          id: id(),
          org_id,
          user_id: null,
          active: true,
          created_at: stamp,
        });
    } else if (old) {
      if (!p.active) {
        if (!p.reassign_to || p.reassign_to === old.id)
          throw Error("Choose an active replacement for unfinished work");
        validAssignee(p.reassign_to);
        s.opportunities
          .filter((o) => o.assigned_to === old.id)
          .forEach((o) => (o.assigned_to = p.reassign_to));
        s.customers
          .filter((c) => c.assigned_to === old.id)
          .forEach((c) => (c.assigned_to = p.reassign_to));
        s.tasks
          .filter((t) => t.assigned_to === old.id && isOpenTask(t))
          .forEach((t) => (t.assigned_to = p.reassign_to));
      }
      old.active = p.active;
    }
    return s;
  }
  if (p.type === "assign_opportunity") {
    requireManager();
    const o = s.opportunities.find((o) => o.id === p.id);
    if (!o) throw Error("Opportunity unavailable");
    assign(o, p.assigned_to);
    return s;
  }
  if (
    p.type === "complete_task" &&
    !manager &&
    !s.tasks.some((t) => t.id === p.id && t.assigned_to === me)
  )
    throw Error("You can only complete your own tasks");
  const activity = (
    cid: string,
    body: string,
    kind: Activity["kind"] = "system",
    oid: string | null = null,
  ) =>
    s.activities.unshift({
      id: id(),
      org_id,
      customer_id: cid,
      opportunity_id: oid,
      body,
      kind,
      created_at: stamp,
      created_by: s.member.name,
    });
  const task = (
    cid: string,
    title: string,
    due: string,
    kind: Task["kind"],
    oid: string | null = null,
  ) =>
    s.tasks.push({
      id: id(),
      org_id,
      customer_id: cid,
      opportunity_id: oid,
      assigned_to: taskAssignee(cid, oid),
      title,
      due_date: due,
      kind,
      completed_at: null,
      canceled_at: null,
    });
  const canonical = (
    o: z.infer<typeof opportunitySchema>,
    old?: Opportunity,
  ) => {
    if (o.assigned_to !== undefined) {
      validAssignee(o.assigned_to);
      if (!manager && o.assigned_to !== (old ? old.assigned_to : me))
        throw Error("Manager access required to reassign an opportunity");
    }
    if (o.inventory_id) {
      const v = s.inventory.find((v) => v.id === o.inventory_id);
      if (!v) throw Error("Vehicle unavailable");
      if (v.status !== "in_stock" && v.id !== old?.inventory_id)
        throw Error("Select an in-stock vehicle");
      o.vehicle_details = inventorySnapshot(v);
      o.vehicle_interest = vehicleName(v);
    }
    if (o.trade)
      o.trade_vehicle =
        o.trade.description || vehicleName(o.trade) || o.trade.vin;
    return o;
  };
  const addOpp = (cid: string, data: z.infer<typeof opportunitySchema>) => {
    const o: Opportunity = {
      ...canonical(data),
      assigned_to:
        data.assigned_to === undefined ? taskAssignee(cid) : data.assigned_to,
      id: id(),
      org_id,
      customer_id: cid,
      sold_on: null,
      lost_reason: "",
      closed_at: null,
      sale_snapshot: null,
      paperwork: {},
      paperwork_revision: 0,
      created_at: stamp,
      updated_at: stamp,
    };
    s.opportunities.unshift(o);
    assign(o, o.assigned_to ?? null);
    activity(cid, "Opportunity created", "system", o.id);
    task(
      cid,
      "Follow up · " + o.title,
      addDays(today, 1),
      "unsold_followup",
      o.id,
    );
    return o;
  };
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
      throw Error("That VIN or stock number already exists in inventory.");
    if (p.id) {
      const v = s.inventory.find((v) => v.id === p.id);
      if (!v) throw Error("Vehicle unavailable");
      Object.assign(v, p.vehicle, { updated_at: stamp });
    } else
      s.inventory.unshift({
        ...p.vehicle,
        id: id(),
        org_id,
        created_at: stamp,
        updated_at: stamp,
      });
  }
  if (p.type === "create_customer") {
    const c: Customer = {
      ...p.customer,
      assigned_to: me ?? null,
      status: "new",
      id: id(),
      org_id,
      sold_on: null,
      created_at: stamp,
      updated_at: stamp,
    };
    s.customers.unshift(c);
    activity(c.id, "Customer profile created");
    if (p.customer.initial_opportunity !== false)
      addOpp(c.id, {
        title: c.vehicle_interest || "Vehicle purchase",
        source: c.source,
        status: "new",
        inventory_id: c.inventory_id ?? null,
        vehicle_interest: c.vehicle_interest,
        vehicle_details: c.vehicle_details ?? null,
        trade_vehicle: c.trade_vehicle,
        trade: c.trade ?? null,
      });
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
    if (!c) throw Error("Customer unavailable");
    if (c.birthday !== p.customer.birthday) {
      s.tasks
        .filter(
          (t) =>
            t.customer_id === c.id && t.kind === "birthday" && isOpenTask(t),
        )
        .forEach((t) => (t.canceled_at = stamp));
      if (p.customer.birthday)
        task(
          c.id,
          p.customer.name + " · birthday",
          nextAnniversary(p.customer.birthday, today),
          "birthday",
        );
    }
    const { name, email, phone, source, birthday, person, co_buyer } =
      p.customer;
    Object.assign(c, {
      name,
      email,
      phone,
      source,
      birthday,
      ...(person !== undefined ? { person } : {}),
      ...(co_buyer !== undefined ? { co_buyer } : {}),
      updated_at: stamp,
    });
    activity(c.id, "Customer contact details updated");
  }
  if (p.type === "create_opportunity") {
    if (!s.customers.some((c) => c.id === p.customer_id))
      throw Error("Customer unavailable");
    addOpp(p.customer_id, p.opportunity);
  }
  if (p.type === "update_opportunity") {
    const o = s.opportunities.find((o) => o.id === p.id);
    if (!o || !opportunityOpen(o))
      throw Error("Closed opportunity is read-only");
    Object.assign(o, canonical(p.opportunity, o), { updated_at: stamp });
    if (p.opportunity.assigned_to !== undefined)
      assign(o, p.opportunity.assigned_to);
    activity(
      o.customer_id,
      "Opportunity vehicle and trade updated",
      "system",
      o.id,
    );
  }
  if (p.type === "close_opportunity" || p.type === "mark_sold") {
    const o = s.opportunities.find((o) =>
      p.type === "close_opportunity"
        ? o.id === p.id
        : o.customer_id === p.customer_id && opportunityOpen(o),
    );
    if (!o) throw Error("Select an active opportunity");
    const outcome = p.type === "mark_sold" ? "sold" : p.outcome;
    if (o.status === outcome) return s;
    if (!opportunityOpen(o)) throw Error("Closed opportunity is read-only");
    const c = s.customers.find((c) => c.id === o.customer_id)!;
    const v = s.inventory.find((v) => v.id === o.inventory_id);
    if (v && outcome === "sold") {
      if (v.status === "sold")
        throw Error("This inventory vehicle has already been sold");
      v.status = "sold";
      o.vehicle_details = inventorySnapshot(v);
    }
    o.status = outcome;
    o.closed_at = stamp;
    o.sold_on = outcome === "sold" ? today : null;
    o.lost_reason = p.type === "close_opportunity" ? p.reason || "" : "";
    o.updated_at = stamp;
    o.sale_snapshot = {
      salesperson: s.staff.find((m) => m.id === o.assigned_to) ?? null,
      customer: structuredClone(c),
      insurance: structuredClone(c.insurance ?? null),
      quote: structuredClone(
        s.quotes
          .filter(
            (q) =>
              q.opportunity_id === o.id &&
              (o.inventory_id
                ? q.inventory_id === o.inventory_id
                : q.vehicle === o.vehicle_interest),
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
      ),
    };
    s.tasks
      .filter(
        (t) =>
          t.opportunity_id === o.id &&
          ["unsold_followup", "appointment"].includes(t.kind) &&
          isOpenTask(t),
      )
      .forEach((t) => (t.canceled_at = stamp));
    if (outcome === "sold") {
      const recent = s.visits
        .filter(
          (v) => v.opportunity_id === o.id && dayKey(v.arrived_at) === today,
        )
        .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at))[0];
      s.visits
        .filter(
          (v) =>
            v.opportunity_id === o.id &&
            (!v.departed_at || v.id === recent?.id),
        )
        .forEach((v) => (v.outcome = "sold"));
      for (const d of [2, 7, 30])
        task(
          c.id,
          d + "-day sold follow-up · " + o.title,
          addDays(today, d),
          "sold_followup",
          o.id,
        );
      task(
        c.id,
        "Purchase anniversary · " + o.title,
        nextAnniversary(today, addDays(today, 1)),
        "anniversary",
        o.id,
      );
    }
    activity(
      c.id,
      "Opportunity marked " +
        outcome +
        (o.lost_reason ? " · " + o.lost_reason : ""),
      "system",
      o.id,
    );
  }
  if (p.type === "save_insurance") {
    const c = s.customers.find((c) => c.id === p.customer_id);
    if (!c) throw Error("Customer unavailable");
    c.insurance = p.insurance;
    c.updated_at = stamp;
    activity(c.id, "Automobile insurance updated");
  }
  if (p.type === "save_paperwork") {
    const o = s.opportunities.find((o) => o.id === p.opportunity_id);
    if (!o) throw Error("Opportunity unavailable");
    if (o.paperwork_revision !== p.revision)
      throw Error(
        "Paperwork changed in another session. Reload before saving.",
      );
    o.paperwork = p.paperwork;
    o.paperwork_revision++;
  }
  if (
    "opportunity_id" in p &&
    p.opportunity_id &&
    "customer_id" in p &&
    !s.opportunities.some(
      (o) => o.id === p.opportunity_id && o.customer_id === p.customer_id,
    )
  )
    throw Error("Opportunity unavailable");
  if (p.type === "add_activity")
    activity(p.customer_id, p.body, p.kind, p.opportunity_id ?? null);
  if (
    p.type === "check_in" &&
    !s.visits.some((v) => v.customer_id === p.customer_id && !v.departed_at)
  ) {
    s.visits.unshift({
      id: id(),
      org_id,
      customer_id: p.customer_id,
      opportunity_id: p.opportunity_id ?? null,
      arrived_at: stamp,
      departed_at: null,
      outcome: "browsing",
    });
    activity(
      p.customer_id,
      "Checked into the showroom",
      "system",
      p.opportunity_id ?? null,
    );
  }
  if (p.type === "check_out") {
    const v = s.visits.find((v) => v.id === p.id);
    if (v && !v.departed_at) {
      v.departed_at = stamp;
      if (v.outcome !== "sold") {
        v.outcome = "unsold";
        if (
          !v.opportunity_id ||
          s.opportunities.some(
            (o) => o.id === v.opportunity_id && opportunityOpen(o),
          )
        )
          task(
            v.customer_id,
            "Follow up after showroom visit",
            addDays(today, 1),
            "unsold_followup",
            v.opportunity_id ?? null,
          );
      }
      activity(
        v.customer_id,
        "Visit ended · customer left",
        "system",
        v.opportunity_id ?? null,
      );
    }
  }
  if (p.type === "create_task") {
    const assigned_to =
      p.assigned_to === undefined
        ? taskAssignee(p.customer_id, p.opportunity_id)
        : validAssignee(p.assigned_to);
    if (!manager && assigned_to !== me)
      throw Error("Only managers can assign tasks to another user");
    s.tasks.push({
      ...p,
      assigned_to,
      id: id(),
      org_id,
      completed_at: null,
      canceled_at: null,
    });
  }
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
          t.opportunity_id ?? null,
        );
    }
  }
  if (p.type === "save_quote") {
    const o = s.opportunities.find((o) =>
      p.opportunity_id
        ? o.id === p.opportunity_id
        : o.customer_id === p.customer_id && opportunityOpen(o),
    );
    if (!o || !opportunityOpen(o)) throw Error("Select an active opportunity");
    const v = s.inventory.find((v) => v.id === o.inventory_id),
      values = { ...p.values, tax: calculateQuote(p.values).tax };
    s.quotes.unshift({
      id: id(),
      org_id,
      customer_id: p.customer_id,
      opportunity_id: o.id,
      vehicle: p.vehicle,
      values,
      created_at: stamp,
      inventory_id: o.inventory_id,
      vehicle_details: v ? inventorySnapshot(v) : o.vehicle_details,
      trade_input: o.trade,
      snapshot_version: 1,
      trade_snapshot: o.trade
        ? {
            ...o.trade,
            allowance: values.tradeAllowance,
            acv: values.acv,
            payoff: values.payoff,
          }
        : null,
    });
  }
  return s;
}
