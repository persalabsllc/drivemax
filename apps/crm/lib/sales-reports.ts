import {
  canManage,
  dayKey,
  myStaffId,
  type Workspace,
  type Opportunity,
} from "./model";
export function salesFunnel(
  ws: Workspace,
  from: string,
  to: string,
  staff = "all",
) {
  const cohort = ws.opportunities.filter(
    (o) =>
      dayKey(o.created_at) >= from &&
      dayKey(o.created_at) <= to &&
      (canManage(ws.member.role)
        ? staff === "all" || o.assigned_to === staff
        : o.assigned_to === myStaffId(ws)),
  );
  function facts(o: Opportunity) {
    const events = (ws.sales_events ?? []).filter(
      (e) => e.opportunity_id === o.id,
    );
    const contacts = [
      ...events.filter((e) => e.event === "contacted").map((e) => e.created_at),
      ...ws.activities
        .filter((a) => a.opportunity_id === o.id && a.kind === "call")
        .map((a) => a.created_at),
      ...(ws.messages ?? [])
        .filter(
          (m) =>
            m.opportunity_id === o.id &&
            m.direction === "outbound" &&
            ["sent", "delivered"].includes(m.status) &&
            m.created_by !== "00000000-0000-4000-8000-000000000000",
        )
        .map((m) => m.updated_at),
    ]
      .filter((t) => t >= o.created_at)
      .sort();
    return {
      o,
      contacted: contacts.length > 0,
      appointed:
        events.some((e) => e.event === "appointment") ||
        (ws.appointments ?? []).some((a) => a.opportunity_id === o.id),
      shown:
        events.some((e) => e.event === "shown") ||
        ws.visits.some((v) => v.opportunity_id === o.id) ||
        (ws.appointments ?? []).some(
          (a) =>
            a.opportunity_id === o.id &&
            ["arrived", "completed"].includes(a.status),
        ),
      sold: o.status === "sold",
      response: contacts[0]
        ? Math.max(
            0,
            (Date.parse(contacts[0]) - Date.parse(o.created_at)) / 60000,
          )
        : null,
    };
  }
  const records = cohort.map(facts);
  const summarize = (rows: typeof records) => ({
    leads: rows.length,
    contacted: rows.filter((r) => r.contacted).length,
    appointments: rows.filter((r) => r.appointed).length,
    shows: rows.filter((r) => r.shown).length,
    sold: rows.filter((r) => r.sold).length,
    responseMinutes: rows.filter((r) => r.response !== null).length
      ? rows.reduce((s, r) => s + (r.response ?? 0), 0) /
        rows.filter((r) => r.response !== null).length
      : null,
  });
  const group = (fn: (o: Opportunity) => string) =>
    [...new Set(cohort.map(fn))]
      .map((name) => ({
        name,
        ...summarize(records.filter((r) => fn(r.o) === name)),
      }))
      .sort((a, b) => b.sold - a.sold || b.leads - a.leads);
  return {
    cohort,
    summary: summarize(records),
    appointmentShows: records.filter((r) => r.appointed && r.shown).length,
    sources: group((o) => o.source || "Unknown"),
    salespeople: group(
      (o) => ws.staff.find((s) => s.id === o.assigned_to)?.name ?? "Unassigned",
    ),
    lostReasons: Object.entries(
      cohort
        .filter((o) => o.status === "lost")
        .reduce<Record<string, number>>((out, o) => {
          const key = o.lost_reason.trim() || "No reason recorded";
          out[key] = (out[key] ?? 0) + 1;
          return out;
        }, {}),
    ).sort((a, b) => b[1] - a[1]),
    vehicles: group((o) =>
      o.inventory_id
        ? ws.inventory.find((v) => v.id === o.inventory_id)?.stock_number ||
          o.vehicle_interest
        : o.vehicle_interest || "No vehicle selected",
    ),
  };
}
export const percent = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : "—";
