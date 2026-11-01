"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Car,
  CheckCircle2,
  Clock,
  Globe,
  MousePointer2,
  RefreshCw,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import {
  activityLabels,
  activityPage,
  activityRange,
  activeTime,
  type WebActivity,
  type WebJourney,
  type WebVisit,
} from "../lib/website-activity";
import { canManage, myStaffId, type Workspace } from "../lib/model";
import { observeActivityRefresh } from "../lib/website-activity-refresh";
const stamp = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const n = (value: number) => value.toLocaleString("en-US");
function demoActivity(): WebActivity {
  const now = new Date().toISOString();
  return {
    summary: {
      visitors: 78,
      visits: 104,
      views: 362,
      returning_visits: 26,
      active_seconds: 13980,
      lead_visits: 9,
      leads: 8,
      chats: 14,
      appointments: 4,
      sales: 1,
      form_starts: 16,
      form_submissions: 6,
      call_clicks: 11,
    },
    total: 2,
    sessions: [
      {
        id: "demo-visit-1",
        visitor_id: "a123ff00-demo",
        started_at: now,
        last_at: now,
        source: "Facebook",
        device: "Mobile",
        is_returning: true,
        views: 5,
        active_seconds: 238,
        entry: "/inventory",
        exit: "/contact",
        lead: true,
        customers: null,
        path: [
          "/inventory",
          "/inventory/2018-nissan-versa-sv-demo",
          "/inventory/2009-ford-fusion-sel-demo",
          "/contact",
        ],
      },
      {
        id: "demo-visit-2",
        visitor_id: "b537ff00-demo",
        started_at: now,
        last_at: now,
        source: "Google",
        device: "Desktop",
        is_returning: false,
        views: 3,
        active_seconds: 111,
        entry: "/",
        exit: "/inventory",
        lead: false,
        customers: null,
        path: ["/", "/about", "/inventory"],
      },
    ],
    vehicles: [
      {
        id: "demo-car-1",
        slug: "",
        title: "2018 Nissan Versa",
        stock_number: "DM2602",
        views: 124,
        shoppers: 42,
        return_visits: 18,
        photo_views: 86,
        active_seconds: 7180,
        lead_visits: 6,
      },
      {
        id: "demo-car-2",
        slug: "",
        title: "2009 Ford Fusion",
        stock_number: "DM2601",
        views: 86,
        shoppers: 31,
        return_visits: 9,
        photo_views: 42,
        active_seconds: 4480,
        lead_visits: 3,
      },
    ],
    sources: [
      { source: "Facebook", visits: 58, visitors: 42, leads: 6 },
      { source: "Google", visits: 31, visitors: 24, leads: 2 },
      { source: "Direct / unknown", visits: 15, visitors: 12, leads: 1 },
    ],
    daily: Array.from({ length: 14 }, (_, i) => ({
      day: new Date(Date.now() - (13 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      visits: [2, 4, 3, 6, 5, 7, 4, 9, 12, 8, 11, 10, 8, 15][i],
    })),
  };
}
export function WebsiteActivity({
  ws,
  demo,
  customerId,
  onCustomer,
}: {
  ws: Workspace;
  demo: boolean;
  customerId?: string;
  onCustomer?: (id: string, opportunityId: string | null) => void;
}) {
  const [range, setRange] = useState(() => activityRange(customerId ? 90 : 30)),
    [rollingDays, setRollingDays] = useState<number | null>(
      customerId ? 90 : 30,
    ),
    [updatedAt, setUpdatedAt] = useState<string | null>(null),
    [source, setSource] = useState(""),
    [vehicle, setVehicle] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<WebActivity | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<WebVisit | null>(null),
    [journey, setJourney] = useState<WebJourney | null>(null),
    [journeyError, setJourneyError] = useState(""),
    [journeyBusy, setJourneyBusy] = useState(false);
  const sequence = useRef(0),
    detailSeq = useRef(0),
    pending = useRef(0);
  const manager = canManage(ws.member.role),
    staffId = myStaffId(ws);
  const allowed =
    manager ||
    (!!customerId &&
      (ws.customers.some(
        (c) => c.id === customerId && c.assigned_to === staffId,
      ) ||
        ws.opportunities.some(
          (o) => o.customer_id === customerId && o.assigned_to === staffId,
        )));
  const query = useCallback(
    () =>
      new URLSearchParams({
        ...range,
        offset: String(offset),
        ...(source ? { source } : {}),
        ...(vehicle ? { vehicle } : {}),
        ...(customerId ? { customer: customerId } : {}),
      }),
    [range, offset, source, vehicle, customerId],
  );
  const load = useCallback(async () => {
    if (!allowed) return;
    if (rollingDays !== null) {
      const latest = activityRange(rollingDays);
      if (latest.from !== range.from || latest.to !== range.to) {
        setRange(latest);
        setOffset(0);
        return;
      }
    }
    const seq = ++sequence.current;
    pending.current++;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        const sample = demoActivity();
        if (customerId) {
          sample.summary = null;
          sample.vehicles = [];
          sample.sources = [];
        }
        setData(sample);
        setUpdatedAt(new Date().toISOString());
        return;
      }
      const r = await fetch("/api/website-activity?" + query(), {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (seq === sequence.current) {
        setData(d);
        setUpdatedAt(new Date().toISOString());
      }
    } catch (e) {
      if (seq === sequence.current) {
        setError(e instanceof Error ? e.message : "Please refresh.");
      }
    } finally {
      pending.current--;
      if (seq === sequence.current) setBusy(false);
    }
  }, [allowed, demo, customerId, query, range, rollingDays]);
  useEffect(() => {
    setData(null);
    setUpdatedAt(null);
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!allowed || demo) return;
    return observeActivityRefresh(() => {
      if (!pending.current) void load();
    });
  }, [allowed, demo, load]);
  useEffect(() => {
    setSelected(null);
    setJourney(null);
    detailSeq.current++;
  }, [range, source, vehicle, customerId, offset]);
  function openVisit(visit: WebVisit) {
    setSelected(visit);
    setJourney(null);
  }
  useEffect(() => {
    if (!selected) return;
    const visit = selected;
    setJourneyError("");
    setJourneyBusy(true);
    const seq = ++detailSeq.current;
    async function loadJourney() {
      try {
        if (demo) {
          const events = (visit.path || []).map((path, i) => ({
            id: String(i),
            kind: "page_view",
            path,
            seconds: 0,
            created_at: visit.started_at,
          }));
          setJourney({ events, event_count: events.length, page_time: [] });
          return;
        }
        const q = query();
        q.set("session", visit.id);
        const r = await fetch("/api/website-activity?" + q, {
          cache: "no-store",
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (seq === detailSeq.current) setJourney(d);
      } catch (e) {
        if (seq === detailSeq.current)
          setJourneyError(e instanceof Error ? e.message : "Please try again.");
      } finally {
        if (seq === detailSeq.current) setJourneyBusy(false);
      }
    }
    void loadJourney();
    return () => {
      detailSeq.current++;
    };
  }, [selected, demo, query, updatedAt]);
  if (!allowed)
    return (
      <p className="muted">
        Website history is available to the assigned salesperson and managers.
      </p>
    );
  const summary = data?.summary,
    peak = Math.max(1, ...(data?.daily.map((d) => d.visits) || []));
  return (
    <div
      className={`web-activity ${customerId ? "web-activity-customer" : ""}`}
    >
      {!customerId && (
        <section className="web-activity-hero">
          <div>
            <span className="eyebrow">
              <Globe size={14} /> THE ONLINE SHOWROOM
            </span>
            <h2>See what gets their attention.</h2>
            <p>From the first vehicle view to the next conversation.</p>
          </div>
          <div className="web-activity-hero-label">
            <span /> Website activity
          </div>
        </section>
      )}
      {demo && (
        <div className="notice">
          Demo preview · All visitor activity and totals below are fictional.
        </div>
      )}
      <div className="web-activity-toolbar">
        <div className="web-activity-presets">
          {[7, 30, 90].map((days) => (
            <button
              className="btn small"
              key={days}
              aria-pressed={rollingDays === days}
              onClick={() => {
                setRollingDays(days);
                setRange(activityRange(days));
                setOffset(0);
              }}
            >
              Last {days} days
            </button>
          ))}
        </div>
        <label>
          From
          <input
            aria-label="Website activity from"
            type="date"
            value={range.from}
            onChange={(e) => {
              setRollingDays(null);
              setRange({ ...range, from: e.target.value });
              setOffset(0);
            }}
          />
        </label>
        <label>
          Through
          <input
            aria-label="Website activity through"
            type="date"
            value={range.to}
            onChange={(e) => {
              setRollingDays(null);
              setRange({ ...range, to: e.target.value });
              setOffset(0);
            }}
          />
        </label>
        {!customerId && (
          <label>
            Source
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setOffset(0);
              }}
            >
              {[
                "",
                "Google",
                "Facebook",
                "Instagram",
                "Bing",
                "Other search",
                "Other social",
                "Referral",
                "Email",
                "Direct / unknown",
              ].map((s) => (
                <option key={s} value={s}>
                  {s || "All sources"}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} />
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="web-activity-update" role="status">
        {demo
          ? "Demo data"
          : "Updates every 15 seconds while this page is open"}
        {updatedAt && (
          <>
            {" "}
            · Last updated{" "}
            {new Date(updatedAt).toLocaleTimeString("en-US", {
              timeZone: "America/New_York",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}{" "}
            Eastern
            {error
              ? " · Update failed; showing the last successful result"
              : ""}
          </>
        )}
        {rollingDays === null && " · Custom date range"}
      </p>
      {vehicle && (
        <div className="notice">
          Showing visits that included the selected vehicle.{" "}
          <button
            className="btn small"
            onClick={() => {
              setVehicle("");
              setOffset(0);
            }}
          >
            Clear vehicle filter
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {summary && (
        <>
          <section className="web-activity-metrics">
            {[
              {
                label: "Unique browsers",
                value: summary.visitors,
                detail: `${n(summary.visits)} visits`,
                icon: Users,
              },
              {
                label: "Vehicle & page views",
                value: summary.views,
                detail: `${n(summary.returning_visits)} return visits`,
                icon: MousePointer2,
              },
              {
                label: "Leads captured",
                value: summary.leads,
                detail: `${summary.visits ? ((summary.lead_visits / summary.visits) * 100).toFixed(1) : "0"}% of visits became leads`,
                icon: TrendingUp,
              },
              {
                label: "Linked appointments",
                value: summary.appointments,
                detail: `${n(summary.sales)} linked sales`,
                icon: CheckCircle2,
              },
            ].map((k) => (
              <article key={k.label}>
                <div className="web-metric-label">
                  <span>{k.label}</span>
                  <k.icon size={18} />
                </div>
                <strong>{n(k.value)}</strong>
                <small>{k.detail}</small>
              </article>
            ))}
          </section>
          <div className="web-activity-overview">
            <section className="web-activity-panel">
              <h3>Visits over time</h3>
              <div className="web-activity-bars" aria-label="Daily visits">
                {data!.daily.length ? (
                  data!.daily.map((d) => (
                    <div key={d.day} title={`${d.day}: ${d.visits} visits`}>
                      <span
                        style={{
                          height: `${Math.max(4, (d.visits / peak) * 100)}%`,
                        }}
                      />
                      <small>{d.day.slice(5)}</small>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Your first tracked visits will appear here.
                  </p>
                )}
              </div>
              <p className="muted">
                {n(summary.chats)} chats started · {n(summary.call_clicks)}{" "}
                phone clicks ·{" "}
                {activeTime(
                  summary.visits
                    ? Math.round(summary.active_seconds / summary.visits)
                    : 0,
                )}{" "}
                average active time
              </p>
            </section>
            <section className="web-activity-panel">
              <h3>Where shoppers come from</h3>
              {data!.sources.map((s) => (
                <div className="web-source" key={s.source}>
                  <span>{s.source}</span>
                  <strong>
                    {n(s.visits)} <small>visits</small>
                  </strong>
                  <span>{n(s.leads)} lead visits</span>
                </div>
              ))}
              {!data!.sources.length && (
                <p className="muted">
                  Sources appear after visitors allow analytics.
                </p>
              )}
              <div className="web-inquiry-progress">
                <strong>{n(summary.form_starts)} inquiry starts</strong>
                <ArrowRight size={16} />
                <strong>{n(summary.form_submissions)} submitted visits</strong>
              </div>
              <small className="muted">
                Starts and submissions are counted separately; visitors can
                submit without a recorded start.
              </small>
            </section>
          </div>
          <section className="web-activity-panel">
            <div className="web-panel-heading">
              <div>
                <h3>
                  <Car size={19} /> Vehicles getting attention
                </h3>
                <p>
                  Ranked by unique browsers. Lead visits include any inquiry
                  made during a visit that viewed that vehicle.
                </p>
              </div>
            </div>
            <div className="web-table-scroll">
              <table className="web-activity-table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Shoppers</th>
                    <th>Views</th>
                    <th>Return visits</th>
                    <th>Photo views</th>
                    <th>Lead visits</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.vehicles.map((v, i) => (
                    <tr key={v.id}>
                      <td>
                        <button
                          className="web-link"
                          onClick={() => {
                            if (!demo) {
                              setVehicle(v.id);
                              setOffset(0);
                            }
                          }}
                        >
                          <span className="web-rank">{i + 1}</span>
                          <span>
                            <strong>{v.title}</strong>
                            <small>
                              {v.stock_number || "Website inventory"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <strong>{n(v.shoppers)}</strong>
                      </td>
                      <td>{n(v.views)}</td>
                      <td>{n(v.return_visits)}</td>
                      <td>{n(v.photo_views)}</td>
                      <td>{n(v.lead_visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data!.vehicles.length && (
                <div className="web-empty">
                  <Car size={28} />
                  <h4>No vehicle views yet</h4>
                  <p>
                    Once visitors allow analytics and browse inventory, vehicle
                    interest will appear here.
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
      <section className="web-activity-panel">
        <div className="web-panel-heading">
          <div>
            <h3>
              <Globe size={18} />{" "}
              {customerId
                ? "Website visits linked to this customer"
                : "Visitor journeys"}
            </h3>
            <p>
              {customerId
                ? "Recorded visits linked through a submitted form or chat. A browser visit is not proof of identity."
                : "Open a visit to follow the pages, vehicle photos, and contact actions in order."}
            </p>
          </div>
          <span className="badge">{n(data?.total || 0)} visits</span>
        </div>
        <div className="web-visit-layout">
          <div className="web-visit-list">
            {data?.sessions.map((visit) => (
              <button
                className={`web-visit ${selected?.id === visit.id ? "selected" : ""}`}
                key={visit.id}
                onClick={() => void openVisit(visit)}
              >
                <div>
                  <strong>
                    {visit.customers?.[0]?.name ||
                      `Visitor ${visit.visitor_id.slice(0, 8)}`}
                  </strong>
                  <small>
                    {stamp(visit.started_at)} · {visit.device}
                  </small>
                </div>
                <div className="web-visit-tags">
                  <span>{visit.source}</span>
                  {visit.is_returning && <span>Returning</span>}
                  {visit.lead && (
                    <span className="web-lead-badge">Lead captured</span>
                  )}
                </div>
                <div className="web-path">
                  {(visit.path || []).map((p, i) => (
                    <span key={i}>
                      {i > 0 && <ArrowRight size={12} />}
                      <span>{activityPage(p)}</span>
                    </span>
                  ))}
                </div>
                <small>
                  {visit.views} page views · {activeTime(visit.active_seconds)}{" "}
                  active <ArrowRight size={13} />
                </small>
              </button>
            ))}
            {!busy && data && !data.sessions.length && (
              <div className="web-empty">
                <Globe size={28} />
                <h4>No tracked visits in this range</h4>
                <p>
                  {customerId
                    ? "Visits appear when a tracked shopper submits their details."
                    : "Try Last 7 days and All sources. Signed-in website staff, opt-outs, privacy signals, and blockers can exclude visits."}
                </p>
              </div>
            )}
          </div>
          {selected && (
            <aside className="web-journey">
              <div className="web-journey-title">
                <div>
                  <span className="eyebrow">VISIT TIMELINE</span>
                  <h4>
                    {selected.customers?.[0]?.name ||
                      `Visitor ${selected.visitor_id.slice(0, 8)}`}
                  </h4>
                  <small>{stamp(selected.started_at)} · Eastern</small>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Close visit timeline"
                  onClick={() => {
                    setSelected(null);
                    detailSeq.current++;
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              {selected.customers?.map((c) => (
                <button
                  key={c.id}
                  className="btn small"
                  onClick={() => onCustomer?.(c.id, c.opportunity_id)}
                  disabled={!onCustomer}
                >
                  Open {c.name} in CRM <ArrowRight size={13} />
                </button>
              ))}
              {journeyBusy && !journey && <p>Loading journey…</p>}
              {journeyError && (
                <p role="alert" className="error">
                  {journeyError}
                </p>
              )}
              <ol className="web-timeline">
                {journey?.events.map((event) => (
                  <li key={event.id}>
                    <span className="web-timeline-dot" />
                    <div>
                      <small>{stamp(event.created_at)}</small>
                      <strong>
                        {activityLabels[event.kind] || event.kind}
                      </strong>
                      <span>{activityPage(event.path)}</span>
                      {event.kind === "page_view" &&
                        !!journey.page_time.find((p) => p.path === event.path)
                          ?.seconds && (
                          <small>
                            <Clock size={12} />{" "}
                            {activeTime(
                              journey.page_time.find(
                                (p) => p.path === event.path,
                              )!.seconds,
                            )}{" "}
                            total on this page during visit
                          </small>
                        )}
                    </div>
                  </li>
                ))}
              </ol>
              {journey && journey.event_count > journey.events.length && (
                <p>
                  Showing the first {journey.events.length} of{" "}
                  {journey.event_count} actions.
                </p>
              )}
            </aside>
          )}
        </div>
        <div className="web-pagination">
          <span>
            {!data
              ? busy
                ? "Loading visits…"
                : "Visits unavailable"
              : data.total
                ? `${offset + 1}–${Math.min(offset + 50, data.total)} of ${data.total}`
                : "0 visits"}
          </span>
          <button
            className="btn small"
            disabled={!offset || busy}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </button>
          <button
            className="btn small"
            disabled={busy || offset + 50 >= (data?.total || 0)}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </button>
        </div>
      </section>
      <p className="web-activity-note">
        Dates use Eastern time. Optional analytics only; privacy choices,
        blockers, and different devices affect counts. Visits end after 30
        minutes without recorded activity. History is kept for 180 days. Linked
        appointments and sales show current outcomes of leads from the selected
        visits, even if the outcome occurred later.
      </p>
    </div>
  );
}
