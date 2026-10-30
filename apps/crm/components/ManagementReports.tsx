"use client";
import { useMemo, useState } from "react";
import {
  Plus,
  Download,
  Printer,
  CalendarClock,
  RefreshCw,
  Archive,
  ArrowLeft,
  Save,
} from "lucide-react";
import { canManage, fullMoney, type Workspace } from "../lib/model";
import {
  buildManagementReport,
  defaultReport,
  defaultSchedule,
  metricLabels,
  reportKinds,
  reportPeriods,
  reportDefinitionSchema,
  reportScheduleSchema,
  reportCsv,
  type MetricKey,
  type ReportDefinition,
  type ReportSchedule,
  type ReportSnapshot,
  type ReportRow,
  type SavedReport,
} from "../lib/management-reports";
import { sourceKey } from "../lib/business";
import { Modal, Empty, SectionTitle } from "./ui";
import { PrintDocument } from "./PrintDocument";
import { downloadCsv, type ManagementRun } from "./ServiceWorkspace";

const stamp = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
const formatMetric = (key: MetricKey, value: number | null) =>
  value === null
    ? "Needs review"
    : ["gross", "pvr", "funding"].includes(key)
      ? fullMoney(value)
      : value.toLocaleString();
const scheduleLabel = (s: ReportSchedule) =>
  s.frequency === "off"
    ? "On demand"
    : `${s.frequency === "daily" ? "Daily" : s.frequency === "weekly" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.weekday] : `Monthly on day ${s.month_day}`} · ${s.hour > 12 ? s.hour - 12 : s.hour}:${String(s.minute).padStart(2, "0")} ${s.hour >= 12 ? "PM" : "AM"} Eastern`;

export function ManagementReports({
  ws,
  run,
  busy,
  demo,
  onRefresh,
  onOpen,
}: {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  demo: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (row: ReportRow) => void;
}) {
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState<"dashboard" | "inbox">("dashboard"),
    [editor, setEditor] = useState<SavedReport | "new" | null>(null),
    [snapshotId, setSnapshotId] = useState(""),
    [printing, setPrinting] = useState(false),
    [drill, setDrill] = useState<ReportRow | null>(null),
    [archived, setArchived] = useState(false);
  const reports = ws.saved_reports ?? [],
    saved = reports.find((r) => r.id === selected),
    definition = saved?.definition ?? defaultReport;
  const live = useMemo(
    () =>
      buildManagementReport(
        ws,
        definition,
        saved?.name ?? "Management overview",
      ),
    [ws, definition, saved?.name],
  );
  const runs = [...(ws.report_runs ?? [])]
    .filter((r) => !selected || r.report_id === selected)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const snapshotRun = (ws.report_runs ?? []).find((r) => r.id === snapshotId);
  const snapshot = snapshotRun?.snapshot;
  const drillDefinition = snapshotRun?.definition ?? definition;
  const shown = snapshot ?? live;
  if (!canManage(ws.member.role)) return null;
  const drillSales = drill
    ? (ws.sales ?? []).filter(
        (s) =>
          s.status === "sold" &&
          s.sold_on >= shown.period.from &&
          s.sold_on <= shown.period.to &&
          (s.snapshot.salesperson?.id ??
            s.snapshot.opportunity?.assigned_to ??
            "unassigned") === drill.id &&
          (!drillDefinition.source ||
            sourceKey(s.snapshot.opportunity?.source ?? "") ===
              sourceKey(drillDefinition.source)),
      )
    : [];
  return (
    <section className="management-page">
      <SectionTitle
        title="Your management desk"
        subtitle="Save the views you use. Keep a dated copy when the numbers matter."
        action={
          <button className="btn primary" onClick={() => setEditor("new")}>
            <Plus size={16} />
            New saved report
          </button>
        }
      />
      {demo && (
        <p className="work-note">
          Demo reports use sample records. Generate now creates a sample
          snapshot; automatic schedules run only in the live CRM.
        </p>
      )}
      <div className="management-report-layout">
        <aside className="report-library" aria-label="Saved reports">
          <button
            className={!selected ? "active" : ""}
            onClick={() => {
              setSelected("");
              setSnapshotId("");
              setTab("dashboard");
            }}
          >
            <strong>Management overview</strong>
            <small>Live dealership totals</small>
          </button>
          {reports
            .filter((r) => r.archived === archived)
            .map((r) => (
              <button
                key={r.id}
                className={selected === r.id ? "active" : ""}
                onClick={() => {
                  setSelected(r.id);
                  setSnapshotId("");
                  setTab("dashboard");
                }}
              >
                <strong>{r.name}</strong>
                <small>{reportKinds[r.definition.kind]}</small>
                <small>
                  {r.archived ? "Archived" : scheduleLabel(r.schedule)}
                </small>
              </button>
            ))}
          {!reports.some((r) => r.archived === archived) && (
            <p className="work-note">
              {archived
                ? "No archived reports."
                : "Your saved views will appear here."}
            </p>
          )}
          <label className="management-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived reports
          </label>
        </aside>
        <div className="report-content">
          <div className="management-tabs">
            <button
              className={tab === "dashboard" ? "active" : ""}
              onClick={() => {
                setTab("dashboard");
                setSnapshotId("");
              }}
            >
              Live dashboard
            </button>
            <button
              className={tab === "inbox" ? "active" : ""}
              onClick={() => setTab("inbox")}
            >
              Reports inbox{" "}
              <span>{runs.filter((r) => r.state === "completed").length}</span>
            </button>
          </div>
          <div className="report-heading">
            <div>
              <h2>
                {snapshot
                  ? snapshot.title
                  : (saved?.name ?? "Management overview")}
              </h2>
              <p>
                {snapshot
                  ? `Saved snapshot · ${stamp(snapshot.generated_at)} Eastern`
                  : saved
                    ? `${reportKinds[definition.kind]} · ${reportPeriods[definition.period]}`
                    : "Month to date · compared with the same days last month"}
              </p>
              {saved?.next_run_at && !saved.archived && (
                <small>
                  <CalendarClock size={13} /> Next snapshot{" "}
                  {stamp(saved.next_run_at)} Eastern
                </small>
              )}
            </div>
            <div className="ops-actions">
              {saved && (
                <button className="btn" onClick={() => setEditor(saved)}>
                  Edit report
                </button>
              )}
              {saved && !saved.archived && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    const result = await run(
                      {
                        type: "queue_management_report",
                        request_id: crypto.randomUUID(),
                        run_id: crypto.randomUUID(),
                        id: saved.id,
                        revision: saved.revision,
                      },
                      "Snapshot requested",
                    );
                    if (result.ok) {
                      setTab("inbox");
                      setSnapshotId("");
                    }
                  }}
                >
                  Generate now
                </button>
              )}
              {!saved && (
                <button className="btn" onClick={() => setEditor("new")}>
                  <Save size={15} />
                  Save a view
                </button>
              )}
            </div>
          </div>
          {tab === "inbox" && !snapshot ? (
            <>
              <p className="work-note">
                Scheduled reports appear here for owners and managers, usually
                within five minutes of the selected time. Saved snapshots keep
                their original figures.{" "}
                <button
                  className="text-btn"
                  disabled={busy}
                  onClick={onRefresh}
                >
                  <RefreshCw size={13} />
                  Refresh inbox
                </button>
              </p>
              {runs.length ? (
                <div className="report-inbox">
                  {runs.map((r) => (
                    <article key={r.id}>
                      <div>
                        <strong>{r.name}</strong>
                        <p>{stamp(r.scheduled_for)} Eastern</p>
                        <small>
                          {r.state === "running"
                            ? "Generating"
                            : r.state === "pending"
                              ? "Queued"
                              : r.state === "failed" && r.attempts < 3
                                ? "Retry pending"
                                : r.state}
                        </small>
                        {r.error && <p role="status">{r.error}</p>}
                      </div>
                      {r.snapshot && (
                        <button
                          className="btn"
                          onClick={() => setSnapshotId(r.id)}
                        >
                          Open snapshot
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No snapshots yet"
                  body="Save a report and select Generate now, or set a daily, weekly, or monthly schedule."
                />
              )}
            </>
          ) : (
            <>
              {snapshot && (
                <button className="text-btn" onClick={() => setSnapshotId("")}>
                  <ArrowLeft size={14} />
                  Back to inbox
                </button>
              )}
              <div className="ops-actions report-export">
                <span>
                  {shown.period.from} — {shown.period.to}
                </span>
                <button
                  className="btn small"
                  onClick={() =>
                    downloadCsv("Drive-Max-Report.csv", reportCsv(shown))
                  }
                >
                  <Download size={14} />
                  Export CSV
                </button>
                <button className="btn small" onClick={() => setPrinting(true)}>
                  <Printer size={14} />
                  Print / PDF
                </button>
              </div>
              <ReportBody
                snapshot={shown}
                onOpen={(row) => {
                  if (row.customer_id || row.inventory_id || row.service_id)
                    onOpen(row);
                  else if (row.staff_id || row.id === "unassigned")
                    setDrill(row);
                }}
              />
            </>
          )}
        </div>
      </div>
      {editor && (
        <ReportEditor
          key={editor === "new" ? "new" : editor.id}
          ws={ws}
          existing={editor === "new" ? undefined : editor}
          run={run}
          busy={busy}
          close={() => setEditor(null)}
          saved={(id) => {
            setSelected(id);
            setSnapshotId("");
            setTab("dashboard");
            setEditor(null);
          }}
        />
      )}
      {drill && (
        <Modal
          title={`${drill.cells[0]} · current deal records`}
          subtitle={`Sold ${shown.period.from} through ${shown.period.to}. Records open in their current state.`}
          onClose={() => setDrill(null)}
        >
          <div className="management-modal-body">
            {drillSales.length ? (
              drillSales.map((s) => (
                <div className="report-inbox" key={s.id}>
                  <article>
                    <span>
                      <strong>{s.snapshot.customer.name}</strong>
                      <small>
                        {s.sold_on} · {s.snapshot.quote?.vehicle ?? "Vehicle"}
                      </small>
                    </span>
                    <button
                      className="btn"
                      onClick={() =>
                        onOpen({
                          id: s.id,
                          cells: [],
                          customer_id: s.customer_id,
                          opportunity_id: s.opportunity_id,
                        })
                      }
                    >
                      Open deal
                    </button>
                  </article>
                </div>
              ))
            ) : (
              <p>
                No matching current sold records. A saved snapshot may include
                deals that have since changed.
              </p>
            )}
          </div>
        </Modal>
      )}
      {printing && (
        <PrintDocument landscape onClose={() => setPrinting(false)}>
          <div className="management-print">
            <h1>{shown.title}</h1>
            <p>
              {shown.period.from} through {shown.period.to} · Generated{" "}
              {stamp(shown.generated_at)} Eastern
            </p>
            <ReportBody snapshot={shown} />
          </div>
        </PrintDocument>
      )}
    </section>
  );
}

function ReportBody({
  snapshot: s,
  onOpen,
}: {
  snapshot: ReportSnapshot;
  onOpen?: (row: ReportRow) => void;
}) {
  const max = Math.max(1, ...s.trend.map((t) => t.units));
  return (
    <>
      <div className="management-cards">
        {s.metrics.map((m) => (
          <article key={m.key}>
            <span>{metricLabels[m.key]}</span>
            <strong>{formatMetric(m.key, m.value)}</strong>
            <small>
              {m.current
                ? "Current position"
                : m.previous === null
                  ? "Comparison unavailable"
                  : `Previous: ${formatMetric(m.key, m.previous)} · ${m.value === null ? "Needs review" : `${m.value - m.previous >= 0 ? "+" : "−"}${formatMetric(m.key, Math.abs(m.value - m.previous))}`}`}
            </small>
            {m.target !== null && (
              <>
                <progress
                  max={Math.max(1, m.target)}
                  value={Math.max(0, m.value ?? 0)}
                  aria-label={`${metricLabels[m.key]} target progress`}
                />
                <small>
                  Target {formatMetric(m.key, m.target)}
                  {m.target > 0 && m.value !== null
                    ? ` · ${Math.round((m.value / m.target) * 100)}%`
                    : ""}
                </small>
              </>
            )}
          </article>
        ))}
      </div>
      {s.trend.length <= 93 && (
        <section className="management-inset report-trend">
          <h3>Retail units by day</h3>
          <div
            className="report-bars"
            role="img"
            aria-label={`${s.trend.reduce((n, t) => n + t.units, 0)} retail units across ${s.trend.length} days. Exact totals appear in the report.`}
          >
            {s.trend.map((t) => (
              <div key={t.date} title={`${t.date}: ${t.units} units`}>
                <span style={{ height: `${(t.units / max) * 100}%` }} />
                <small>{Number(t.date.slice(-2))}</small>
              </div>
            ))}
          </div>
          <p>
            {s.period.from} to {s.period.to}
          </p>
        </section>
      )}
      <div className="table-wrap">
        <table className="ops-table report-table">
          <thead>
            <tr>
              {s.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
              {onOpen && <th>Current record</th>}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id}>
                {r.cells.map((c, i) => (
                  <td key={i}>
                    {typeof c === "number" &&
                    /gross|due$|price|invested/i.test(s.headers[i])
                      ? fullMoney(c)
                      : (c ?? "—")}
                  </td>
                ))}
                {onOpen && (
                  <td>
                    {(r.customer_id ||
                      r.inventory_id ||
                      r.service_id ||
                      r.staff_id ||
                      r.id === "unassigned") && (
                      <button className="text-btn" onClick={() => onOpen(r)}>
                        View
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!s.rows.length && (
          <p className="work-note">No records match this view.</p>
        )}
      </div>
      <div className="report-notes">
        <strong>{s.row_count} rows · How these figures are calculated</strong>
        {s.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </>
  );
}

function ReportEditor({
  ws,
  existing,
  run,
  busy,
  close,
  saved,
}: {
  ws: Workspace;
  existing?: SavedReport;
  run: ManagementRun;
  busy: boolean;
  close: () => void;
  saved: (id: string) => void;
}) {
  const [id] = useState(existing?.id ?? crypto.randomUUID()),
    [name, setName] = useState(existing?.name ?? ""),
    [d, setD] = useState<ReportDefinition>(
      existing?.definition ?? { ...defaultReport },
    ),
    [s, setS] = useState<ReportSchedule>(
      existing?.schedule ?? { ...defaultSchedule },
    ),
    [error, setError] = useState("");
  const patch = (value: Partial<ReportDefinition>) => setD({ ...d, ...value });
  async function save(archived = existing?.archived ?? false) {
    const a = reportDefinitionSchema.safeParse(d),
      b = reportScheduleSchema.safeParse(s);
    if (!name.trim() || !a.success || !b.success) {
      setError(
        !name.trim()
          ? "Give this report a name."
          : !a.success
            ? a.error.issues[0].message
            : "Review the schedule.",
      );
      return;
    }
    const result = await run(
      {
        type: "save_management_report",
        request_id: crypto.randomUUID(),
        id,
        revision: existing?.revision ?? 0,
        name: name.trim(),
        definition: a.data,
        schedule: b.data,
        archived,
      },
      archived ? "Report archived" : "Report saved",
    );
    if (result.ok) saved(id);
    else
      setError(
        result.error ?? "Could not save. Refresh if this report changed.",
      );
  }
  return (
    <Modal
      title={existing ? "Edit saved report" : "Build a saved report"}
      subtitle="Owners and managers can open these reports and their scheduled snapshots."
      wide
      onClose={close}
      className="management-modal"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="management-modal-body">
          <div className="form-grid">
            <label>
              Report name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                placeholder="Weekly funding review"
              />
            </label>
            <label>
              Report type
              <select
                value={d.kind}
                onChange={(e) =>
                  patch({ kind: e.target.value as ReportDefinition["kind"] })
                }
              >
                {Object.entries(reportKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select
                value={d.period}
                onChange={(e) =>
                  patch({
                    period: e.target.value as ReportDefinition["period"],
                  })
                }
              >
                {Object.entries(reportPeriods).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Team member
              <select
                value={d.staff_id ?? ""}
                onChange={(e) => patch({ staff_id: e.target.value || null })}
              >
                <option value="">Entire team</option>
                {ws.staff.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </label>
            {d.period === "custom" && (
              <>
                <label>
                  From
                  <input
                    type="date"
                    required
                    value={d.from ?? ""}
                    onChange={(e) => patch({ from: e.target.value || null })}
                  />
                </label>
                <label>
                  Through
                  <input
                    type="date"
                    required
                    min={d.from ?? undefined}
                    value={d.to ?? ""}
                    onChange={(e) => patch({ to: e.target.value || null })}
                  />
                </label>
              </>
            )}
            <label>
              Lead source
              <input
                value={d.source}
                onChange={(e) => patch({ source: e.target.value })}
                maxLength={80}
                list="management-sources"
                placeholder="All sources"
              />
              <datalist id="management-sources">
                {[...new Set(ws.opportunities.map((o) => o.source))]
                  .sort()
                  .map((v) => (
                    <option key={v} value={v} />
                  ))}
              </datalist>
            </label>
            <label>
              Aged inventory threshold (days)
              <input
                type="number"
                min={0}
                max={3650}
                value={d.min_age}
                onChange={(e) => patch({ min_age: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              Retail unit target
              <input
                type="number"
                min={0}
                max={10000}
                value={d.unit_target ?? ""}
                onChange={(e) =>
                  patch({
                    unit_target:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Optional"
              />
            </label>
            <label>
              Deal gross target
              <input
                type="number"
                min={0}
                max={10000000}
                step="0.01"
                value={d.gross_target ?? ""}
                onChange={(e) =>
                  patch({
                    gross_target:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Optional"
              />
            </label>
          </div>
          <label className="management-check">
            <input
              type="checkbox"
              checked={d.no_appointments}
              onChange={(e) => patch({ no_appointments: e.target.checked })}
            />
            Inventory: only vehicles without an upcoming appointment
          </label>
          <label className="management-check">
            <input
              type="checkbox"
              checked={d.overdue_only}
              onChange={(e) => patch({ overdue_only: e.target.checked })}
            />
            Funding, follow-up, and service detail: only overdue items
          </label>
          <p className="work-note">
            Date ranges affect sales and new opportunities. Money due,
            inventory, tasks, and service show the current position. Team and
            source filters apply through linked records.
          </p>
          <fieldset className="report-card-picker">
            <legend>Dashboard cards</legend>
            {Object.entries(metricLabels).map(([key, label]) => (
              <label className="management-check" key={key}>
                <input
                  type="checkbox"
                  checked={d.metrics.includes(key as MetricKey)}
                  onChange={(e) =>
                    patch({
                      metrics: e.target.checked
                        ? [...d.metrics, key as MetricKey]
                        : d.metrics.filter((k) => k !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <section className="management-inset">
            <h3>Deliver a snapshot to the Reports inbox</h3>
            <div className="form-grid">
              <label>
                Frequency
                <select
                  value={s.frequency}
                  onChange={(e) =>
                    setS({
                      ...s,
                      frequency: e.target.value as ReportSchedule["frequency"],
                    })
                  }
                >
                  <option value="off">Off — generate on demand</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              {s.frequency !== "off" && (
                <>
                  <label>
                    Eastern time
                    <select
                      value={`${s.hour}:${s.minute}`}
                      onChange={(e) => {
                        const [hour, minute] = e.target.value
                          .split(":")
                          .map(Number);
                        setS({ ...s, hour, minute });
                      }}
                    >
                      {Array.from({ length: 60 }, (_, i) => ({
                        hour: 6 + Math.floor(i / 4),
                        minute: (i % 4) * 15,
                      })).map((v) => (
                        <option
                          key={`${v.hour}:${v.minute}`}
                          value={`${v.hour}:${v.minute}`}
                        >
                          {v.hour > 12 ? v.hour - 12 : v.hour}:
                          {String(v.minute).padStart(2, "0")}{" "}
                          {v.hour >= 12 ? "PM" : "AM"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.frequency === "weekly" && (
                    <label>
                      Weekday
                      <select
                        value={s.weekday}
                        onChange={(e) =>
                          setS({ ...s, weekday: Number(e.target.value) })
                        }
                      >
                        {[
                          "Sunday",
                          "Monday",
                          "Tuesday",
                          "Wednesday",
                          "Thursday",
                          "Friday",
                          "Saturday",
                        ].map((v, i) => (
                          <option key={i} value={i}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {s.frequency === "monthly" && (
                    <label>
                      Day of month
                      <select
                        value={s.month_day}
                        onChange={(e) =>
                          setS({ ...s, month_day: Number(e.target.value) })
                        }
                      >
                        {Array.from({ length: 28 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
            <p className="work-note">
              Snapshots are private to this CRM. Delivery uses the existing
              five-minute scheduler; it does not email recipients. A schedule
              pauses if the manager who last saved it loses access.
            </p>
          </section>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-foot">
          {existing && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void save(!existing.archived)}
            >
              <Archive size={15} />
              {existing.archived ? "Restore report" : "Archive report"}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Save report
          </button>
        </footer>
      </form>
    </Modal>
  );
}
