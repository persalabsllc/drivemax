"use client";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Clock,
  Mail,
  CalendarCheck,
  ListChecks,
} from "lucide-react";
import {
  canManage,
  myStaffId,
  type Workspace,
  type Customer,
  type Task,
} from "../lib/model";
import { workToday, salesStages, type WorkItem } from "../lib/sales-work";
import { type Appointment, appointmentTime } from "../lib/appointments";
import { Avatar, Empty } from "./ui";
export function WorkToday({
  ws,
  onCustomer,
  onTask,
  onAppointment,
  onEmail,
  compact = false,
}: {
  ws: Workspace;
  onCustomer: (c: Customer, id?: string | null) => void;
  onTask: (t: Task) => void;
  onAppointment: (a: Appointment) => void;
  onEmail: (c: Customer, id: string | null) => void;
  compact?: boolean;
}) {
  const [scope, setScope] = useState("all"),
    [filter, setFilter] = useState("all");
  const rows = useMemo(() => workToday(ws, new Date(), scope), [ws, scope]);
  const categories = {
    all: "Everything",
    reply: "Waiting for us",
    lead: "New leads",
    appointment: "Appointments",
    task: "Tasks",
    next_step: "No next step",
    quote: "Proposals",
    funding: "Funding",
  };
  const selected = rows.filter((r) => filter === "all" || r.kind === filter);
  function action(r: WorkItem) {
    const c = ws.customers.find((c) => c.id === r.customer_id);
    const t = ws.tasks.find((t) => t.id === r.task_id);
    const a = ws.appointments?.find((a) => a.id === r.appointment_id);
    if (t) onTask(t);
    else if (a) onAppointment(a);
    else if (c && r.kind === "reply" && r.channel === "email")
      onEmail(c, r.opportunity_id);
    else if (c) onCustomer(c, r.opportunity_id);
  }
  return (
    <section className="work-today panel">
      <div className="work-hero">
        <div>
          <span className="eyebrow">YOUR NEXT CONVERSATION</span>
          <h2>Work Today</h2>
          <p>One place to see who needs you and what moves the deal forward.</p>
        </div>
        <div className="work-hero-count">
          <strong>{rows.length}</strong>
          <span>actions to review</span>
        </div>
      </div>
      <div className="work-stats">
        {[
          [
            Mail,
            "Awaiting a reply",
            rows.filter((r) => r.kind === "reply").length,
          ],
          [
            CalendarCheck,
            "Appointments",
            rows.filter((r) => r.kind === "appointment").length,
          ],
          [
            ListChecks,
            "Missing next step",
            rows.filter((r) => r.kind === "next_step").length,
          ],
        ].map(([Icon, label, count]) => {
          const I = Icon as typeof Mail;
          return (
            <div key={String(label)}>
              <I size={18} />
              <span>{String(label)}</span>
              <strong>{String(count)}</strong>
            </div>
          );
        })}
      </div>
      <div className="work-toolbar">
        <label>
          Focus
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {canManage(ws.member.role) ? (
          <label>
            Assigned to
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">Entire team</option>
              <option value="unassigned">Unassigned</option>
              {ws.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === myStaffId(ws) ? " (me)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>Your assigned opportunities and tasks</span>
        )}
      </div>
      {!selected.length ? (
        <Empty
          title="You're caught up here"
          body="Change the filter to review another part of your day."
        />
      ) : (
        <div className="work-list">
          {selected.slice(0, compact ? 6 : 150).map((r) => {
            const c = ws.customers.find((c) => c.id === r.customer_id),
              o = ws.opportunities.find((o) => o.id === r.opportunity_id),
              p = ws.deal_progress?.find((p) => p.id === o?.id);
            return (
              <article className={`work-row urgency-${r.priority}`} key={r.key}>
                <Avatar name={c?.name ?? "Team task"} />
                <div className="work-person">
                  <button onClick={() => c && onCustomer(c, r.opportunity_id)}>
                    <strong>{c?.name ?? "Team task"}</strong>
                  </button>
                  <span>
                    {o?.vehicle_interest ||
                      c?.vehicle_interest ||
                      "General follow-up"}
                  </span>
                  <small>
                    {ws.staff.find((s) => s.id === r.assigned_to)?.name ??
                      "Needs an owner"}
                    {p ? ` · ${salesStages[p.stage]}` : ""}
                  </small>
                </div>
                <div className="work-reason">
                  <strong>{r.title}</strong>
                  <span>{r.detail}</span>
                  <small>
                    <Clock size={12} />
                    {r.kind === "appointment"
                      ? appointmentTime(r.at)
                      : new Date(r.at).toLocaleDateString("en-US", {
                          timeZone: "America/New_York",
                          month: "short",
                          day: "numeric",
                        })}
                  </small>
                </div>
                <button
                  className={`btn small ${r.priority === 0 ? "primary" : ""}`}
                  onClick={() => action(r)}
                >
                  {r.kind === "reply"
                    ? "Reply"
                    : r.kind === "appointment"
                      ? "Appointment"
                      : r.kind === "task"
                        ? "Open task"
                        : "Work deal"}
                  <ArrowUpRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      {selected.length > (compact ? 6 : 150) && (
        <p className="work-footnote">
          Showing {compact ? 6 : 150} of {selected.length} actions.{" "}
          {compact
            ? "Open Work Today for the full queue."
            : "Use the filters to narrow the list."}
        </p>
      )}
    </section>
  );
}
