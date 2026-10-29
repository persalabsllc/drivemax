"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, Printer } from "lucide-react";
import { canManage, dayKey, money, type Workspace } from "../lib/model";
import { salesFunnel, percent } from "../lib/sales-reports";
import { csvText, saleMath } from "../lib/operations";
import { Advertising } from "./Advertising";
import type { Command } from "../lib/model";
import { SectionTitle } from "./ui";
export function SalesReports({
  ws,
  run,
  busy,
  error,
}: {
  ws: Workspace;
  run: (p: Command, message?: string) => Promise<{ ok: boolean }>;
  busy: boolean;
  error: string;
}) {
  const [reportTab, setReportTab] = useState("funnel");
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("printing-sales-report");
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const timer = setTimeout(() => window.print(), 100);
    return () => {
      clearTimeout(timer);
      document.body.classList.remove("printing-sales-report");
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);
  const [from, setFrom] = useState(dayKey().slice(0, 7) + "-01"),
    [to, setTo] = useState(dayKey()),
    [staff, setStaff] = useState("all"),
    [group, setGroup] = useState<"sources" | "salespeople" | "vehicles">(
      "sources",
    );
  const data = salesFunnel(ws, from, to, staff),
    s = data.summary;
  const sales = (canManage(ws.member.role) ? (ws.sales ?? []) : []).filter(
    (s) =>
      s.status === "sold" && data.cohort.some((o) => o.id === s.opportunity_id),
  );
  const totals = sales.map((s) => saleMath(s, ws.commissions));
  const gross = totals.filter((t) => t.gross !== null);
  const products = sales.filter((s) =>
    (s.snapshot.quote?.values.products ?? []).some((p) => p.price > 0),
  );
  const rows = data[group];
  const table = (
    <table className="ops-table">
      <thead>
        <tr>
          <th>
            {group === "sources"
              ? "Lead source"
              : group === "salespeople"
                ? "Salesperson"
                : "Stock / vehicle"}
          </th>
          <th>Opportunities</th>
          <th>Contacted</th>
          <th>Appointments</th>
          <th>Shows</th>
          <th>Sold</th>
          <th>Close rate</th>
          <th>Avg. first response</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.leads}</td>
            <td>{r.contacted}</td>
            <td>{r.appointments}</td>
            <td>{r.shows}</td>
            <td>{r.sold}</td>
            <td>{percent(r.sold, r.leads)}</td>
            <td>
              {r.responseMinutes === null
                ? "—"
                : r.responseMinutes < 60
                  ? `${Math.round(r.responseMinutes)} min`
                  : `${(r.responseMinutes / 60).toFixed(1)} hr`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  function exportCsv() {
    const csv = csvText([
      [
        "Group",
        "Opportunities",
        "Contacted",
        "Appointments",
        "Shows",
        "Sold",
        "Close rate",
        "Average first response minutes",
      ],
      ...rows.map((r) => [
        r.name,
        r.leads,
        r.contacted,
        r.appointments,
        r.shows,
        r.sold,
        percent(r.sold, r.leads),
        r.responseMinutes ?? "",
      ]),
    ]);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Drive-Max-Sales-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      {canManage(ws.member.role) && (
        <div className="business-tabs" aria-label="Sales report type">
          <button
            className={reportTab === "funnel" ? "active" : ""}
            onClick={() => setReportTab("funnel")}
          >
            Sales funnel
          </button>
          <button
            className={reportTab === "advertising" ? "active" : ""}
            onClick={() => setReportTab("advertising")}
          >
            Advertising profitability
          </button>
        </div>
      )}
      {reportTab === "advertising" && canManage(ws.member.role) ? (
        <Advertising ws={ws} run={run} busy={busy} error={error} />
      ) : (
        <section className="panel sales-reports">
          <SectionTitle
            title="From inquiry to sold"
            subtitle="Measure opportunities created in the selected period and their outcomes so far."
            action={
              <div className="ops-actions">
                <button className="btn small" onClick={exportCsv}>
                  <Download size={14} />
                  CSV
                </button>
                <button className="btn small" onClick={() => setPrinting(true)}>
                  <Printer size={14} />
                  Print
                </button>
              </div>
            }
          />
          <div className="work-toolbar no-print">
            <label>
              Opportunity created from
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            {canManage(ws.member.role) && (
              <label>
                Salesperson
                <select
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                >
                  <option value="all">Entire team</option>
                  {ws.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="sales-funnel">
            {[
              ["Opportunities", s.leads],
              ["Contacted", s.contacted],
              ["Appointments", s.appointments],
              ["Shows", s.shows],
              ["Sold", s.sold],
            ].map(([label, n]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <div className="workflow-summary">
            <span>
              Contact rate <strong>{percent(s.contacted, s.leads)}</strong>
            </span>
            <span>
              Appointment rate{" "}
              <strong>{percent(s.appointments, s.leads)}</strong>
            </span>
            <span>
              Show rate{" "}
              <strong>{percent(data.appointmentShows, s.appointments)}</strong>
            </span>
            <span>
              Close rate <strong>{percent(s.sold, s.leads)}</strong>
            </span>
          </div>
          <p className="work-note">
            First response counts logged calls and personal outbound messages.
            Automatic acknowledgments are excluded. These are opportunity
            cohorts, so a sale may occur after the selected date range. Older
            records only contribute milestones supported by their saved history.
          </p>
          <div className="work-toolbar no-print">
            <label>
              Compare by
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value as typeof group)}
              >
                <option value="sources">Lead source</option>
                <option value="salespeople">Salesperson</option>
                <option value="vehicles">Stock / vehicle</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">{table}</div>
          {canManage(ws.member.role) && (
            <div className="workflow-summary">
              <span>
                Gross per retail unit{" "}
                <strong>
                  {gross.length
                    ? money(
                        gross.reduce((sum, t) => sum + (t.gross ?? 0), 0) /
                          gross.length,
                      )
                    : "—"}
                </strong>
              </span>
              <span>
                F&I product penetration{" "}
                <strong>{percent(products.length, sales.length)}</strong>
              </span>
              <small>
                Gross uses completed accounting for {gross.length} of{" "}
                {sales.length} sold deals in this cohort. Use Accounting for
                reports by sold date.
              </small>
            </div>
          )}
          <div className="report-lost">
            <h3>Recorded lost reasons</h3>
            {data.lostReasons.length ? (
              data.lostReasons.map(([r, n]) => (
                <div key={r}>
                  <span>{r}</span>
                  <strong>{n}</strong>
                </div>
              ))
            ) : (
              <p>No lost opportunities in this cohort.</p>
            )}
          </div>
        </section>
      )}
      {printing &&
        createPortal(
          <section className="sales-report-print">
            <h1>Drive Max · Sales funnel</h1>
            <p>
              Opportunities created {from} through {to} · Outcomes recorded to
              date
            </p>
            <p>
              {s.leads} opportunities · {s.contacted} contacted ·{" "}
              {s.appointments} appointments · {s.shows} shows · {s.sold} sold
            </p>
            {table}
            <p>
              First response excludes automatic messages. Figures are based on
              recorded activity.
            </p>
          </section>,
          document.body,
        )}
    </>
  );
}
