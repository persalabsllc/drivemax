import { z } from "zod";
import { addDays, dayKey, isOpenTask, type Workspace } from "./model";
import { receivableRows, sourceKey } from "./business";
import { saleMath, csvText } from "./operations";
import { daysOnHand, vehicleName } from "./vehicles";
import { serviceLabel, serviceOpen, serviceStatuses } from "./service";

export const reportKinds = {
  overview: "Management dashboard",
  funding: "Money and funding due",
  inventory: "Inventory watch",
  salespeople: "Sales by salesperson",
  followup: "Follow-up exceptions",
  service: "Service and We Owe",
} as const;
export const reportPeriods = {
  month_to_date: "Month to date",
  last_month: "Last month",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  yesterday: "Yesterday",
  custom: "Custom dates",
} as const;
export const metricLabels = {
  sold: "Retail units sold",
  gross: "Deal gross",
  pvr: "Gross per complete deal",
  leads: "New opportunities",
  funding: "Confirmed money due",
  aged: "Aged inventory",
  tasks: "Overdue tasks",
  repairs: "Open repair orders",
  promises: "Overdue We Owe",
} as const;
export type MetricKey = keyof typeof metricLabels;
export const reportDefinitionSchema = z
  .object({
    kind: z.enum([
      "overview",
      "funding",
      "inventory",
      "salespeople",
      "followup",
      "service",
    ]),
    period: z.enum([
      "month_to_date",
      "last_month",
      "last_7_days",
      "last_30_days",
      "yesterday",
      "custom",
    ]),
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
    staff_id: z.uuid().nullable(),
    source: z.string().trim().max(80),
    min_age: z.number().int().min(0).max(3650),
    no_appointments: z.boolean(),
    overdue_only: z.boolean(),
    metrics: z
      .array(
        z.enum([
          "sold",
          "gross",
          "pvr",
          "leads",
          "funding",
          "aged",
          "tasks",
          "repairs",
          "promises",
        ]),
      )
      .min(1)
      .max(9),
    unit_target: z.number().int().min(0).max(10000).nullable(),
    gross_target: z.number().finite().min(0).max(10000000).nullable(),
  })
  .refine(
    (d) =>
      d.period !== "custom" ||
      (!!d.from &&
        !!d.to &&
        d.from <= d.to &&
        Date.parse(d.to) - Date.parse(d.from) <= 366 * 86400000),
    "Choose a date range of at most one year.",
  )
  .refine(
    (d) => new Set(d.metrics).size === d.metrics.length,
    "Choose each dashboard card once.",
  );
export const reportScheduleSchema = z.object({
  frequency: z.enum(["off", "daily", "weekly", "monthly"]),
  hour: z.number().int().min(6).max(20),
  minute: z.number().int().min(0).max(59).multipleOf(15),
  weekday: z.number().int().min(0).max(6),
  month_day: z.number().int().min(1).max(28),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;
export type SavedReport = {
  id: string;
  org_id: string;
  name: string;
  definition: ReportDefinition;
  schedule: ReportSchedule;
  archived: boolean;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  next_run_at: string | null;
};
export type ReportRow = {
  id: string;
  cells: (string | number | null)[];
  customer_id?: string;
  opportunity_id?: string;
  inventory_id?: string;
  service_id?: string;
  staff_id?: string;
};
export type ReportSnapshot = {
  version: 1;
  title: string;
  generated_at: string;
  period: {
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
  };
  metrics: {
    key: MetricKey;
    value: number | null;
    previous: number | null;
    target: number | null;
    current: boolean;
  }[];
  headers: string[];
  rows: ReportRow[];
  notes: string[];
  trend: { date: string; units: number; gross: number }[];
  row_count: number;
};
export type ReportRun = {
  id: string;
  org_id: string;
  report_id: string;
  report_revision: number;
  name: string;
  definition: ReportDefinition;
  scheduled_for: string;
  state: "pending" | "running" | "completed" | "failed" | "canceled";
  attempts: number;
  snapshot: ReportSnapshot | null;
  error: string;
  created_at: string;
  completed_at: string | null;
};
export const reportCommands = [
  z.object({
    type: z.literal("save_management_report"),
    request_id: z.uuid(),
    id: z.uuid(),
    revision: z.number().int().min(0),
    name: z.string().trim().min(1).max(100),
    definition: reportDefinitionSchema,
    schedule: reportScheduleSchema,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("queue_management_report"),
    request_id: z.uuid(),
    id: z.uuid(),
    revision: z.number().int().min(1),
    run_id: z.uuid(),
  }),
] as const;
export type ReportCommand = z.infer<(typeof reportCommands)[number]>;
export const defaultReport: ReportDefinition = {
  kind: "overview",
  period: "month_to_date",
  from: null,
  to: null,
  staff_id: null,
  source: "",
  min_age: 45,
  no_appointments: false,
  overdue_only: false,
  metrics: ["sold", "gross", "funding", "aged", "tasks", "promises"],
  unit_target: null,
  gross_target: null,
};
export const defaultSchedule: ReportSchedule = {
  frequency: "off",
  hour: 8,
  minute: 0,
  weekday: 1,
  month_day: 1,
};
export function reportRange(d: ReportDefinition, today: string) {
  let from = today,
    to = today;
  if (d.period === "custom") {
    from = d.from!;
    to = d.to!;
  }
  if (d.period === "month_to_date") from = today.slice(0, 7) + "-01";
  if (d.period === "last_month") {
    to = addDays(today.slice(0, 7) + "-01", -1);
    from = to.slice(0, 7) + "-01";
  }
  if (d.period === "last_7_days") from = addDays(today, -6);
  if (d.period === "last_30_days") from = addDays(today, -29);
  if (d.period === "yesterday") from = to = addDays(today, -1);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  let previous_to = addDays(from, -1),
    previous_from = addDays(from, -days);
  if (d.period === "last_month" || d.period === "month_to_date") {
    const priorEnd = addDays(from.slice(0, 7) + "-01", -1);
    previous_from = priorEnd.slice(0, 7) + "-01";
    previous_to =
      d.period === "last_month"
        ? priorEnd
        : [addDays(previous_from, days - 1), priorEnd].sort()[0];
  }
  return { from, to, previous_from, previous_to };
}
// Scheduler SQL uses the same local-calendar rule. Normal business hours avoid ambiguous DST times.
export function nextReportRun(
  schedule: ReportSchedule,
  after: Date,
): string | null {
  if (schedule.frequency === "off") return null;
  const day = dayKey(after);
  for (let i = 0; i < 40; i++) {
    const date = addDays(day, i),
      weekday = new Date(date + "T12:00:00Z").getUTCDay();
    if (schedule.frequency === "weekly" && weekday !== schedule.weekday)
      continue;
    if (
      schedule.frequency === "monthly" &&
      Number(date.slice(-2)) !== schedule.month_day
    )
      continue;
    for (const offset of [4, 5]) {
      const candidate = new Date(`${date}T00:00:00Z`);
      candidate.setUTCHours(schedule.hour + offset, schedule.minute);
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(candidate);
      if (
        parts ===
          `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}` &&
        candidate > after
      )
        return candidate.toISOString();
    }
  }
  throw Error("Report settings are invalid.");
}
export function buildManagementReport(
  ws: Workspace,
  definition: ReportDefinition,
  title: string,
  now = new Date(),
): ReportSnapshot {
  const d = reportDefinitionSchema.parse(definition),
    today = dayKey(now),
    range = reportRange(d, today),
    inRange = (date: string, from: string, to: string) =>
      date >= from && date <= to;
  const staffName = (id: string | null | undefined) =>
    ws.staff.find((s) => s.id === id)?.name ?? "Unassigned";
  const opportunities = ws.opportunities.filter(
    (o) =>
      (!d.staff_id || o.assigned_to === d.staff_id) &&
      (!d.source || sourceKey(o.source) === sourceKey(d.source)),
  );
  const oids = new Set(opportunities.map((o) => o.id)),
    cids = new Set(opportunities.map((o) => o.customer_id));
  const sales = (ws.sales ?? []).filter(
    (s) =>
      s.status === "sold" &&
      (!d.staff_id ||
        (s.snapshot?.salesperson?.id ??
          s.snapshot?.opportunity?.assigned_to) === d.staff_id) &&
      (!d.source ||
        sourceKey(s.snapshot?.opportunity?.source ?? "") ===
          sourceKey(d.source)),
  );
  const financials = (from: string, to: string) => {
    const selected = sales.filter((s) => inRange(s.sold_on, from, to));
    const maths = selected
      .map((s) => saleMath(s, ws.commissions))
      .filter((s) => s.gross !== null);
    const gross = maths.reduce((n, s) => n + s.gross!, 0);
    return {
      sold: selected.length,
      gross: selected.length && !maths.length ? null : gross,
      pvr: maths.length ? gross / maths.length : null,
      incomplete: selected.length - maths.length,
    };
  };
  const current = financials(range.from, range.to),
    previous = financials(range.previous_from, range.previous_to);
  const funds = receivableRows(ws, today).filter(
    (r) => r.sale.status === "sold" && sales.some((s) => s.id === r.sale.id),
  );
  const tasks = ws.tasks.filter(
    (t) =>
      isOpenTask(t) &&
      (!d.staff_id || t.assigned_to === d.staff_id) &&
      (!d.source ||
        (t.opportunity_id
          ? oids.has(t.opportunity_id)
          : !!t.customer_id && cids.has(t.customer_id))),
  );
  const upcoming = new Set(
    (ws.appointments ?? [])
      .filter(
        (a) =>
          ["scheduled", "confirmed", "arrived"].includes(a.status) &&
          a.starts_at >= now.toISOString(),
      )
      .map(
        (a) =>
          ws.opportunities.find((o) => o.id === a.opportunity_id)?.inventory_id,
      )
      .filter(Boolean),
  );
  const inventory = ws.inventory.filter(
    (v) =>
      ["in_stock", "pending"].includes(v.status) &&
      (daysOnHand(v.acquired_on, today) ?? 0) >= d.min_age &&
      (!d.no_appointments || !upcoming.has(v.id)) &&
      ((!d.staff_id && !d.source) ||
        opportunities.some((o) => o.inventory_id === v.id)),
  );
  const orders = (ws.service_orders ?? []).filter(
    (o) =>
      (!d.staff_id || o.assigned_to === d.staff_id) &&
      (!d.source || (!!o.customer_id && cids.has(o.customer_id))),
  );
  const activeOrders = orders.filter(serviceOpen),
    overdueOrders = activeOrders.filter((o) => o.due_on && o.due_on < today);
  const values: Record<MetricKey, number | null> = {
    sold: current.sold,
    gross: current.gross,
    pvr: current.pvr,
    leads: opportunities.filter((o) =>
      inRange(dayKey(o.created_at), range.from, range.to),
    ).length,
    funding: funds.reduce((n, r) => n + (r.due ?? 0), 0),
    aged: inventory.length,
    tasks: tasks.filter((t) => t.due_date < today).length,
    repairs: activeOrders.length,
    promises: overdueOrders.filter((o) => o.kind === "we_owe").length,
  };
  const prior: Partial<Record<MetricKey, number | null>> = {
    sold: previous.sold,
    gross: previous.gross,
    pvr: previous.pvr,
    leads: opportunities.filter((o) =>
      inRange(dayKey(o.created_at), range.previous_from, range.previous_to),
    ).length,
  };
  const notes = [
    `Sales use sold dates; opportunity counts use created dates. Period: ${range.from} through ${range.to}.`,
    `Comparison: ${range.previous_from} through ${range.previous_to}. Current balances, inventory, tasks, and repairs are as of ${today}; historical values are not inferred.`,
  ];
  if (current.incomplete || previous.incomplete)
    notes.push(
      `Incomplete deal costs: ${current.incomplete} this period, ${previous.incomplete} comparison period. Those deals count as sold but are excluded from gross and PVR.`,
    );
  const unreviewed = funds.filter((r) => r.due === null).length;
  if (unreviewed)
    notes.push(
      `${unreviewed} sold deal(s) need their expected funds reviewed and are excluded from money-due totals.`,
    );
  const rows: ReportRow[] = [];
  let headers: string[] = [];
  if (d.kind === "funding") {
    headers = [
      "Customer / vehicle",
      "Sold",
      "Lender",
      "Lender due",
      "Customer due",
      "Next due date",
      "Status",
    ];
    funds
      .filter(
        (r) => (r.due === null || r.due > 0) && (!d.overdue_only || r.overdue),
      )
      .forEach((r) =>
        rows.push({
          id: r.sale.id,
          customer_id: r.sale.customer_id,
          opportunity_id: r.sale.opportunity_id,
          cells: [
            r.sale.snapshot.customer.name +
              " · " +
              (r.sale.snapshot.quote?.vehicle ?? ""),
            r.sale.sold_on,
            r.plan?.lender ?? "",
            r.lenderBalance === null
              ? "Needs review"
              : Math.max(0, r.lenderBalance),
            r.customerBalance === null
              ? "Needs review"
              : Math.max(0, r.customerBalance),
            [
              r.lenderBalance && r.lenderBalance > 0
                ? r.plan?.lender_due
                : null,
              r.customerBalance && r.customerBalance > 0
                ? r.plan?.customer_due
                : null,
            ]
              .filter(Boolean)
              .sort()[0] ?? "Not set",
            r.overdue ? "Overdue" : r.due === null ? "Review amounts" : "Open",
          ],
        }),
      );
  } else if (d.kind === "inventory") {
    headers = [
      "Stock",
      "Vehicle",
      "Days in stock",
      "Total invested",
      "Asking price",
      "Upcoming appointment",
    ];
    inventory
      .sort((a, b) => a.acquired_on.localeCompare(b.acquired_on))
      .forEach((v) =>
        rows.push({
          id: v.id,
          inventory_id: v.id,
          cells: [
            v.stock_number,
            vehicleName(v),
            daysOnHand(v.acquired_on, today),
            v.cost + v.recon,
            v.price,
            upcoming.has(v.id) ? "Yes" : "None",
          ],
        }),
      );
  } else if (d.kind === "followup") {
    headers = ["Customer", "Task", "Assigned to", "Due", "Status"];
    tasks
      .filter((t) => !d.overdue_only || t.due_date < today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .forEach((t) =>
        rows.push({
          id: t.id,
          customer_id: t.customer_id ?? undefined,
          opportunity_id: t.opportunity_id ?? undefined,
          cells: [
            ws.customers.find((c) => c.id === t.customer_id)?.name ??
              "General task",
            t.title,
            staffName(t.assigned_to),
            t.due_date,
            t.due_date < today ? "Overdue" : "Open",
          ],
        }),
      );
  } else if (d.kind === "service") {
    headers = [
      "Repair order",
      "Customer / vehicle",
      "Work / promise",
      "Assigned to",
      "Vendor",
      "Due",
      "Status",
    ];
    (d.overdue_only ? overdueOrders : orders)
      .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"))
      .forEach((o) =>
        rows.push({
          id: o.id,
          customer_id: o.customer_id ?? undefined,
          service_id: o.id,
          cells: [
            serviceLabel(o),
            `${o.customer_name || "Inventory"} · ${o.vehicle}`,
            o.concern,
            staffName(o.assigned_to),
            o.vendor,
            o.due_on,
            serviceStatuses[o.status],
          ],
        }),
      );
  } else {
    headers = [
      "Salesperson",
      "Units sold",
      "Previous units",
      "Change",
      "Complete deal gross",
      "Gross per complete deal",
      "Incomplete costs",
    ];
    const ids = [
      ...new Set([
        ...sales.map(
          (s) =>
            s.snapshot?.salesperson?.id ??
            s.snapshot?.opportunity?.assigned_to ??
            null,
        ),
        ...ws.staff
          .filter((s) => s.active && (!d.staff_id || s.id === d.staff_id))
          .map((s) => s.id),
      ]),
    ];
    for (const id of ids) {
      const sold = sales.filter(
          (s) =>
            (s.snapshot?.salesperson?.id ??
              s.snapshot?.opportunity?.assigned_to ??
              null) === id,
        ),
        currentSales = sold.filter((s) =>
          inRange(s.sold_on, range.from, range.to),
        ),
        priorSales = sold.filter((s) =>
          inRange(s.sold_on, range.previous_from, range.previous_to),
        );
      const complete = currentSales
          .map((s) => saleMath(s, ws.commissions))
          .filter((s) => s.gross !== null),
        gross = complete.reduce((n, s) => n + s.gross!, 0);
      rows.push({
        id: id ?? "unassigned",
        staff_id: id ?? undefined,
        cells: [
          staffName(id),
          currentSales.length,
          priorSales.length,
          currentSales.length - priorSales.length,
          currentSales.length && !complete.length ? null : gross,
          complete.length ? gross / complete.length : null,
          currentSales.length - complete.length,
        ],
      });
    }
  }
  const trend: ReportSnapshot["trend"] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const f = financials(date, date);
    trend.push({ date, units: f.sold, gross: f.gross ?? 0 });
  }
  return {
    version: 1,
    title,
    generated_at: now.toISOString(),
    period: range,
    metrics: d.metrics.map((key) => ({
      key,
      value: values[key],
      previous: prior[key] ?? null,
      current: !(key in prior),
      target:
        key === "sold"
          ? d.unit_target
          : key === "gross"
            ? d.gross_target
            : null,
    })),
    headers,
    rows,
    notes,
    trend,
    row_count: rows.length,
  };
}
export function reportCsv(snapshot: ReportSnapshot) {
  return csvText([
    [snapshot.title],
    ["Generated", snapshot.generated_at],
    ["Period", snapshot.period.from, snapshot.period.to],
    ...snapshot.metrics.map((m) => [
      metricLabels[m.key],
      m.value ?? "Incomplete",
      "Previous",
      m.previous ?? "Not available",
      "Target",
      m.target ?? "Not set",
    ]),
    [],
    snapshot.headers,
    ...snapshot.rows.map((r) => r.cells.map((c) => c ?? "Not available")),
    [],
    ...snapshot.notes.map((n) => [n]),
  ]);
}
