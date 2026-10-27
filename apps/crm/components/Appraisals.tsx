"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Car,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  Gauge,
  History,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  money,
  myStaffId,
  type Command,
  type Customer,
  type Workspace,
} from "../lib/model";
import {
  appraisalDataSchema,
  appraisalEntries,
  appraisalMath,
  basisLabels,
  comparableSummary,
  compLabels,
  driveMaxComparables,
  newAppraisalData,
  safeResearchUrl,
  sourceLabels,
  tradeMatchesAppraisal,
  type Appraisal,
  type AppraisalData,
  type Comparable,
} from "../lib/appraisals";
import { vehicleName } from "../lib/vehicles";
import { VinField } from "./VehicleFields";
import { Empty } from "./ui";
import { PrintDocument } from "./PrintDocument";

type Props = {
  ws: Workspace;
  busy: boolean;
  demo: boolean;
  run: (c: Command, message?: string) => Promise<{ ok: boolean }>;
  onCustomer: (c: Customer, opportunity?: string) => void;
};
type Selection = {
  id: string;
  opportunity_id: string | null;
  source: Appraisal["source"];
};
const statusLabel = {
  draft: "In progress",
  review: "Needs review",
  valued: "Approved",
  archived: "Archived",
};
const value = (n: number | null) => (n === null ? "—" : fullMoney(n));

export function Appraisals(props: Props) {
  const { ws } = props;
  const [selection, setSelection] = useState<Selection | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("active");
  const entries = appraisalEntries(ws);
  const active = entries.filter(
    (r) => !r.history && r.appraisal?.status !== "archived",
  );
  const rows = entries.filter((r) => {
    const a = r.appraisal,
      o = r.opportunity;
    if (filter === "active" && (r.history || a?.status === "archived"))
      return false;
    if (
      ["review", "valued"].includes(filter) &&
      (r.history || a?.status !== filter)
    )
      return false;
    if (
      ["street", "auction", "trade"].includes(filter) &&
      (r.source !== filter || r.history || a?.status === "archived")
    )
      return false;
    if (filter === "history" && !r.history && a?.status !== "archived")
      return false;
    return [
      r.vehicle,
      r.customerName,
      o?.trade?.vin,
      a?.data.vehicle.vin,
      ws.staff.find((s) => s.id === o?.assigned_to)?.name,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  if (selection)
    return (
      <AppraisalEditor
        key={selection.id}
        {...props}
        selection={selection}
        onBack={() => setSelection(null)}
      />
    );
  return (
    <div className="valuation-desk">
      <section className="valuation-hero">
        <div>
          <span className="valuation-eyebrow">
            <Sparkles size={15} /> DRIVE MAX · BUY SMART
          </span>
          <h2>
            Know the car.
            <br />
            <em>Know your number.</em>
          </h2>
          <p>
            A clear view of the market, the work it needs, and the room for
            profit.
          </p>
          <div className="valuation-hero-tags">
            <span>
              <Car size={14} /> Customer trades
            </span>
            <span>Street purchases</span>
            <span>Auction buys</span>
          </div>
        </div>
        <div className="valuation-hero-action">
          <span className="valuation-orbit">
            <Gauge size={42} />
          </span>
          <button
            className="btn valuation-primary"
            onClick={() =>
              setSelection({
                id: crypto.randomUUID(),
                opportunity_id: null,
                source: "street",
              })
            }
          >
            <Plus size={17} /> New valuation
          </button>
          <small>No customer profile required</small>
        </div>
      </section>
      <div className="valuation-stats">
        {[
          {
            label: "On the appraisal desk",
            count: active.length,
            tone: "blue",
            filter: "active",
          },
          {
            label: "Waiting for a manager",
            count: active.filter((r) => r.appraisal?.status === "review")
              .length,
            tone: "amber",
            filter: "review",
          },
          {
            label: "Approved valuations",
            count: active.filter((r) => r.appraisal?.status === "valued")
              .length,
            tone: "green",
            filter: "valued",
          },
          {
            label: "Completed & archived",
            count: entries.filter(
              (r) => r.history || r.appraisal?.status === "archived",
            ).length,
            tone: "violet",
            filter: "history",
          },
        ].map((s) => (
          <button
            key={s.label}
            className={`valuation-stat ${s.tone}`}
            onClick={() => setFilter(s.filter)}
          >
            <span>{s.label}</span>
            <strong>{s.count.toString().padStart(2, "0")}</strong>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <section className="panel valuation-queue">
        <div className="section-heading">
          <div>
            <h2>
              <ClipboardList size={18} /> The appraisal desk
            </h2>
            <p>
              Trades appear here as soon as they are added to a customer’s
              opportunity.
            </p>
          </div>
          <label className="valuation-search">
            <span className="sr-only">Search appraisals</span>
            <Search size={16} />
            <input
              aria-label="Search appraisals"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Customer, vehicle, VIN or salesperson…"
            />
          </label>
        </div>
        <div className="valuation-filters" aria-label="Appraisal filters">
          {[
            ["active", "Open desk"],
            ["review", "Needs review"],
            ["valued", "Approved"],
            ["trade", "Trades"],
            ["street", "Street"],
            ["auction", "Auction"],
            ["history", "History"],
            ["all", "All"],
          ].map(([v, l]) => (
            <button
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="valuation-cards">
          {rows.map((r) => {
            const a = r.appraisal,
              o = r.opportunity,
              v = o?.trade || a?.data.vehicle;
            const stale = !!a && !!o && !tradeMatchesAppraisal(o, a.data);
            const status = r.history ? "history" : a?.status || "new";
            return (
              <button
                key={r.id}
                className={`valuation-card ${status}`}
                onClick={() =>
                  setSelection({
                    id: a?.id || crypto.randomUUID(),
                    opportunity_id: o?.id || null,
                    source: r.source,
                  })
                }
              >
                <div className="valuation-card-top">
                  <span className={`valuation-pill ${status}`}>
                    {r.history
                      ? `Deal ${o?.status || "history"}`
                      : a
                        ? statusLabel[a.status]
                        : "Not yet appraised"}
                  </span>
                  <span className="valuation-source">
                    {sourceLabels[r.source]}
                  </span>
                </div>
                <h3>{r.vehicle || "Trade details needed"}</h3>
                <p>{r.customerName}</p>
                <div className="valuation-car-meta">
                  <span>
                    {v?.mileage === null || v?.mileage === undefined
                      ? "Mileage not entered"
                      : `${v.mileage.toLocaleString()} miles`}
                  </span>
                  <span>{v?.vin || "VIN not entered"}</span>
                </div>
                <div className="valuation-card-bottom">
                  <div>
                    <small>
                      {a?.status === "valued" ? "Approved ACV" : "Working ACV"}
                    </small>
                    <strong>
                      {value(a?.data.proposed_acv ?? o?.trade?.acv ?? null)}
                    </strong>
                  </div>
                  <span className="valuation-open">
                    Open valuation <ArrowUpRight size={16} />
                  </span>
                </div>
                <small className="valuation-assignee">
                  {o
                    ? ws.staff.find((s) => s.id === o.assigned_to)?.name ||
                      "Unassigned"
                    : a
                      ? ws.staff.find((s) => s.id === a.created_by)?.name ||
                        "Team valuation"
                      : ""}
                  {stale ? " · Trade details have changed" : ""}
                </small>
              </button>
            );
          })}
        </div>
        {!rows.length && (
          <Empty
            title={
              query
                ? "No matching appraisals"
                : "Your next smart buy starts here"
            }
            body="Add a trade to a customer profile, or start a valuation for a street purchase or auction vehicle."
            action={
              <button
                className="btn"
                onClick={() =>
                  setSelection({
                    id: crypto.randomUUID(),
                    opportunity_id: null,
                    source: "street",
                  })
                }
              >
                New valuation
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}

function NumberField({
  label,
  n,
  onChange,
  nullable = false,
  integer = false,
  max = 1000000,
}: {
  label: string;
  n: number | null;
  onChange: (n: number | null) => void;
  nullable?: boolean;
  integer?: boolean;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        step={integer ? "1" : "0.01"}
        value={n ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value === "" && nullable ? null : Number(e.target.value),
          )
        }
      />
    </label>
  );
}
function ResearchLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const safe = safeResearchUrl(href);
  return safe ? (
    <a
      className="btn small"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink size={13} />
    </a>
  ) : null;
}
function AppraisalEditor({
  ws,
  run,
  busy,
  demo,
  onCustomer,
  selection,
  onBack,
}: Props & { selection: Selection; onBack: () => void }) {
  const record = ws.appraisals?.find((a) => a.id === selection.id),
    o = ws.opportunities.find((o) => o.id === selection.opportunity_id);
  const [data, setData] = useState<AppraisalData>(() =>
    structuredClone(record?.data || newAppraisalData(o)),
  );
  const [source, setSource] = useState(selection.source),
    [revision, setRevision] = useState(record?.revision || 0);
  const [tab, setTab] = useState("vehicle"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [printing, setPrinting] = useState(false);
  const [connection, setConnection] = useState<{
      connected: boolean;
      canSearch: boolean;
    } | null>(null),
    [marketBusy, setMarketBusy] = useState(false);
  const manager = canManage(ws.member.role),
    closed = !!o && ["sold", "lost"].includes(o.status);
  const editable =
    !closed &&
    (manager ||
      (o
        ? o.assigned_to === myStaffId(ws)
        : !record || record.created_by === myStaffId(ws)));
  const dirty =
    JSON.stringify(data) !==
      JSON.stringify(record?.data || newAppraisalData(o)) ||
    (!record && source !== selection.source);
  const conflict = !!record && record.revision !== revision;
  const mismatch = !!o && !tradeMatchesAppraisal(o, data);
  const stats = appraisalMath(data),
    history = driveMaxComparables(ws, data.vehicle),
    retail = comparableSummary(data.comparables);
  const customer = ws.customers.find((c) => c.id === o?.customer_id);
  const change = (p: Partial<AppraisalData>) => {
    setData((d) => ({ ...d, ...p }));
    setError("");
    setNotice("");
  };
  const vehicle = (p: Partial<AppraisalData["vehicle"]>) =>
    change({ vehicle: { ...data.vehicle, ...p } });
  const saved = !!record && !dirty && !conflict;
  useEffect(() => {
    let current = true;
    if (!demo)
      fetch("/api/appraisals/market")
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
          if (current) setConnection(v);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [demo]);
  const back = () => {
    if (
      !dirty ||
      window.confirm("Leave this appraisal and discard unsaved changes?")
    )
      onBack();
  };
  async function action(c: Command, message: string) {
    setError("");
    setNotice("");
    const result = await run(c, message);
    if (result.ok) {
      setRevision(revision + 1);
      setNotice(message);
    } else
      setError(
        "The appraisal could not be saved. Check the message above, then reload if another user has changed it.",
      );
  }
  async function save(status: "draft" | "review") {
    const p = appraisalDataSchema.safeParse(data);
    if (!p.success) {
      setError(
        `${p.error.issues[0].path.join(" · ")}: ${p.error.issues[0].message}`,
      );
      return;
    }
    await action(
      {
        type: "save_appraisal",
        id: selection.id,
        revision,
        source,
        opportunity_id: selection.opportunity_id,
        status,
        data: p.data,
      },
      status === "review"
        ? "Appraisal sent for manager review"
        : "Appraisal saved",
    );
  }
  function addComparable(c: Comparable) {
    if (data.comparables.length >= 30) {
      setError("Keep up to 30 comparable vehicles per appraisal.");
      return;
    }
    if (
      data.comparables.some(
        (x) =>
          x.id === c.id || (!!x.vin && x.vin === c.vin && x.date === c.date),
      )
    ) {
      setNotice("That comparable is already in this appraisal.");
      return;
    }
    change({ comparables: [...data.comparables, c] });
  }
  async function marketSearch() {
    setMarketBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/appraisals/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle: data.vehicle,
          zip: data.zip,
          radius: data.radius,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      const fresh: Comparable[] = result.comparables.filter(
        (c: Comparable) =>
          !data.comparables.some((x) => x.vin && x.vin === c.vin),
      );
      change({ comparables: [...data.comparables, ...fresh].slice(0, 30) });
      setNotice(
        `${fresh.length} comparable listings returned. Review mileage, trim, condition and fees before using them.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market search unavailable.");
    } finally {
      setMarketBusy(false);
    }
  }
  return (
    <div className="valuation-desk valuation-editor">
      <div className="valuation-editor-nav">
        <button className="text-btn" onClick={back}>
          <ArrowLeft size={16} /> Appraisal desk
        </button>
        <div>
          {record && (
            <span className={`valuation-pill ${record.status}`}>
              {statusLabel[record.status]} · v{record.revision}
            </span>
          )}
          <button className="btn small" onClick={() => setPrinting(true)}>
            <Printer size={15} /> Print worksheet
          </button>
          {customer && (
            <button
              className="btn small"
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm(
                    "Open the customer profile and discard unsaved appraisal changes?",
                  )
                )
                  onCustomer(customer, o?.id);
              }}
            >
              Customer profile <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      </div>
      <section className="valuation-editor-title">
        <span className="valuation-title-icon">
          <Car size={25} />
        </span>
        <div>
          <span className="valuation-eyebrow">
            {sourceLabels[source]} · {customer?.name || "Standalone valuation"}
          </span>
          <h2>{vehicleName(data.vehicle) || "Build a new valuation"}</h2>
          <p>
            {data.vehicle.vin || "VIN optional for a standalone valuation"}
            {data.vehicle.mileage !== null
              ? ` · ${data.vehicle.mileage.toLocaleString()} miles`
              : ""}
          </p>
        </div>
      </section>
      {closed && (
        <p className="valuation-notice">
          This opportunity is {o?.status}. Its appraisal and deal values are
          retained for reference.
        </p>
      )}
      {!editable && !closed && (
        <p className="valuation-notice">
          The assigned salesperson or a manager can edit this appraisal.
        </p>
      )}
      {conflict && (
        <div className="valuation-warning" role="alert">
          This appraisal changed in another session. Reload the saved version
          before continuing.{" "}
          <button
            className="btn small"
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Replace your unsaved edits with the saved version?",
                )
              ) {
                setData(structuredClone(record!.data));
                setRevision(record!.revision);
                setError("");
              }
            }}
          >
            Reload saved appraisal
          </button>
        </div>
      )}
      {mismatch && record && !closed && (
        <div className="valuation-warning">
          The appraisal vehicle does not match the current trade. Approval and
          ACV updates are blocked.{" "}
          {editable && o?.trade && (
            <button
              className="btn small"
              onClick={() => {
                const next = newAppraisalData(o);
                if (data.vehicle.vin !== next.vehicle.vin) {
                  if (
                    !window.confirm(
                      "Start fresh research for the current trade? This resets the working prices, costs and comparisons.",
                    )
                  )
                    return;
                  change(next);
                } else
                  change({
                    vehicle: next.vehicle,
                    description: o.trade_vehicle,
                  });
                setNotice(
                  "Current trade details loaded. Review values and condition, then save for a new approval.",
                );
              }}
            >
              Use current trade details
            </button>
          )}
        </div>
      )}
      <div className="valuation-layout">
        <form
          className="panel valuation-workbook"
          onSubmit={(e) => {
            e.preventDefault();
            void save("draft");
          }}
        >
          <div
            className="valuation-tabs"
            role="tablist"
            aria-label="Valuation sections"
          >
            {[
              ["vehicle", "Vehicle & condition"],
              ["research", "Research & values"],
              ["offer", "Costs & offer"],
            ].map(([id, label], i) => (
              <button
                type="button"
                role="tab"
                id={`valuation-tab-${id}`}
                aria-controls={`valuation-panel-${id}`}
                aria-selected={tab === id}
                key={id}
                onClick={() => setTab(id)}
              >
                <span>0{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <fieldset
            disabled={!editable || busy || conflict || marketBusy}
            className="valuation-fields"
          >
            {tab === "vehicle" && (
              <section
                role="tabpanel"
                id="valuation-panel-vehicle"
                aria-labelledby="valuation-tab-vehicle"
              >
                <div className="valuation-section-title">
                  <Car size={20} />
                  <div>
                    <h3>The vehicle</h3>
                    <p>Decode a VIN or enter the details you have.</p>
                  </div>
                </div>
                {!selection.opportunity_id && (
                  <label>
                    Purchase source
                    <select
                      aria-label="Purchase source"
                      disabled={!!record}
                      value={source}
                      onChange={(e) =>
                        setSource(e.target.value as Appraisal["source"])
                      }
                    >
                      <option value="street">Street purchase</option>
                      <option value="auction">Auction buy</option>
                      <option value="other">Other purchase</option>
                    </select>
                  </label>
                )}
                <VinField
                  label="Appraisal VIN"
                  vin={data.vehicle.vin}
                  demo={demo}
                  onChange={(vin) => vehicle({ vin })}
                  onDecoded={(v) =>
                    setData((d) => ({
                      ...d,
                      vehicle: {
                        ...d.vehicle,
                        year: v.year || d.vehicle.year,
                        make: v.make,
                        model: v.model,
                        trim: v.trim,
                      },
                    }))
                  }
                />
                <div className="valuation-grid three">
                  <label>
                    Year
                    <input
                      type="number"
                      min="1900"
                      max="2100"
                      value={data.vehicle.year || ""}
                      onChange={(e) =>
                        vehicle({ year: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Make
                    <input
                      value={data.vehicle.make}
                      maxLength={250}
                      onChange={(e) => vehicle({ make: e.target.value })}
                    />
                  </label>
                  <label>
                    Model
                    <input
                      value={data.vehicle.model}
                      maxLength={250}
                      onChange={(e) => vehicle({ model: e.target.value })}
                    />
                  </label>
                  <label>
                    Trim
                    <input
                      value={data.vehicle.trim}
                      maxLength={250}
                      onChange={(e) => vehicle({ trim: e.target.value })}
                    />
                  </label>
                  <NumberField
                    label="Mileage"
                    n={data.vehicle.mileage}
                    nullable
                    integer
                    max={3000000}
                    onChange={(mileage) => vehicle({ mileage })}
                  />
                  <label>
                    Vehicle / seller notes
                    <input
                      value={data.description}
                      maxLength={250}
                      onChange={(e) => change({ description: e.target.value })}
                      placeholder="Seller, auction / lane, unit…"
                    />
                  </label>
                </div>
                <div className="valuation-section-title">
                  <ShieldCheck size={20} />
                  <div>
                    <h3>Condition & inspection</h3>
                    <p>
                      Record what you inspected and what still needs checking.
                    </p>
                  </div>
                </div>
                <div className="valuation-grid">
                  <label>
                    Overall condition
                    <select
                      aria-label="Overall condition"
                      value={data.condition}
                      onChange={(e) =>
                        change({
                          condition: e.target
                            .value as AppraisalData["condition"],
                        })
                      }
                    >
                      {[
                        ["uninspected", "Not inspected"],
                        ["excellent", "Excellent"],
                        ["good", "Good"],
                        ["fair", "Fair"],
                        ["poor", "Poor"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Title / history status
                    <select
                      aria-label="Title / history status"
                      value={data.title}
                      onChange={(e) =>
                        change({
                          title: e.target.value as AppraisalData["title"],
                        })
                      }
                    >
                      {[
                        ["unverified", "Not verified"],
                        ["clean", "Clean — verified by staff"],
                        ["branded", "Branded title"],
                        ["salvage", "Salvage"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Inspection notes
                  <textarea
                    value={data.inspection_notes}
                    maxLength={4000}
                    onChange={(e) =>
                      change({ inspection_notes: e.target.value })
                    }
                    placeholder="Test drive, warning lights, tires, brakes, body / paint, accident history, keys, service records…"
                  />
                </label>
                <button
                  type="button"
                  className="btn valuation-next"
                  onClick={() => setTab("research")}
                >
                  Research this vehicle <ArrowUpRight size={15} />
                </button>
              </section>
            )}
            {tab === "research" && (
              <section
                role="tabpanel"
                id="valuation-panel-research"
                aria-labelledby="valuation-tab-research"
              >
                <div className="valuation-section-title">
                  <Search size={20} />
                  <div>
                    <h3>Build the evidence</h3>
                    <p>
                      Research the exact trim, mileage, condition and location.
                    </p>
                  </div>
                </div>
                <div className="valuation-grid">
                  <label>
                    Market ZIP
                    <input
                      inputMode="numeric"
                      maxLength={5}
                      value={data.zip}
                      onChange={(e) =>
                        change({ zip: e.target.value.replace(/\D/g, "") })
                      }
                    />
                  </label>
                  <label>
                    Search radius
                    <select
                      aria-label="Search radius"
                      value={data.radius}
                      onChange={(e) =>
                        change({ radius: Number(e.target.value) })
                      }
                    >
                      {[25, 50, 75, 100, 150, 250, 500].map((r) => (
                        <option key={r} value={r}>
                          {r} miles
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="valuation-research-links">
                  <ResearchLink href="https://www.kbb.com/car-values/">
                    Kelley Blue Book
                  </ResearchLink>
                  <ResearchLink href="https://www.jdpower.com/cars">
                    J.D. Power
                  </ResearchLink>
                  <ResearchLink
                    href={`https://www.google.com/search?q=${encodeURIComponent(`${vehicleName(data.vehicle)} used cars for sale near ${data.zip}`)}`}
                  >
                    Market listings
                  </ResearchLink>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          `${vehicleName(data.vehicle)}\nVIN: ${data.vehicle.vin || "Not entered"}\nMileage: ${data.vehicle.mileage ?? "Not entered"}\nZIP: ${data.zip}`,
                        )
                        .then(() =>
                          setNotice(
                            "Vehicle details copied for your research.",
                          ),
                        )
                        .catch(() =>
                          setError(
                            "Copy unavailable. You can select the VIN above.",
                          ),
                        )
                    }
                  >
                    <Copy size={13} /> Copy vehicle details
                  </button>
                </div>
                <p className="valuation-help">
                  KBB and J.D. Power open their research sites. Record the
                  values you find below; book values are entered by your team,
                  not automatically retrieved.
                </p>
                <div className="valuation-subhead">
                  <h3>Book values</h3>
                  <button
                    type="button"
                    className="btn small"
                    disabled={data.books.length >= 20}
                    onClick={() =>
                      change({
                        books: [
                          ...data.books,
                          {
                            id: crypto.randomUUID(),
                            source: "KBB",
                            basis: "trade",
                            low: null,
                            high: null,
                            date: dayKey(),
                            condition: "",
                            url: "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Add book value
                  </button>
                </div>
                {!data.books.length && (
                  <p className="valuation-inline-empty">
                    No book values recorded yet. Add a dated trade-in,
                    private-party, retail or wholesale value.
                  </p>
                )}
                {data.books.map((b, index) => (
                  <div className="valuation-research-row" key={b.id}>
                    <div className="valuation-subhead">
                      <strong>Book value {index + 1}</strong>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove book value ${index + 1}`}
                        onClick={() =>
                          change({
                            books: data.books.filter((x) => x.id !== b.id),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="valuation-grid three">
                      <label>
                        Book / source
                        <input
                          value={b.source}
                          onChange={(e) =>
                            change({
                              books: data.books.map((x) =>
                                x.id === b.id
                                  ? { ...x, source: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Value basis
                        <select
                          aria-label="Value basis"
                          value={b.basis}
                          onChange={(e) =>
                            change({
                              books: data.books.map((x) =>
                                x.id === b.id
                                  ? {
                                      ...x,
                                      basis: e.target.value as typeof b.basis,
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          {Object.entries(basisLabels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Value date
                        <input
                          type="date"
                          value={b.date}
                          onChange={(e) =>
                            change({
                              books: data.books.map((x) =>
                                x.id === b.id
                                  ? { ...x, date: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                      <NumberField
                        label="Low / single value"
                        nullable
                        n={b.low}
                        onChange={(low) =>
                          change({
                            books: data.books.map((x) =>
                              x.id === b.id ? { ...x, low } : x,
                            ),
                          })
                        }
                      />
                      <NumberField
                        label="High value (optional)"
                        nullable
                        n={b.high}
                        onChange={(high) =>
                          change({
                            books: data.books.map((x) =>
                              x.id === b.id ? { ...x, high } : x,
                            ),
                          })
                        }
                      />
                      <label>
                        Condition / notes
                        <input
                          value={b.condition}
                          onChange={(e) =>
                            change({
                              books: data.books.map((x) =>
                                x.id === b.id
                                  ? { ...x, condition: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Source link (optional)
                      <input
                        type="url"
                        placeholder="https://…"
                        value={b.url}
                        onChange={(e) =>
                          change({
                            books: data.books.map((x) =>
                              x.id === b.id ? { ...x, url: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                <div className="valuation-subhead">
                  <h3>Comparable vehicles</h3>
                  <button
                    type="button"
                    className="btn small"
                    disabled={data.comparables.length >= 30}
                    onClick={() =>
                      addComparable({
                        id: crypto.randomUUID(),
                        vehicle:
                          vehicleName(data.vehicle) || "Comparable vehicle",
                        vin: "",
                        mileage: null,
                        price: 0,
                        basis: "retail_asking",
                        source: "Market listing",
                        url: "",
                        date: dayKey(),
                        included: true,
                        notes: "",
                      })
                    }
                  >
                    <Plus size={14} /> Add comparable
                  </button>
                </div>
                <div className="valuation-market-status">
                  <span
                    className={`valuation-dot ${connection?.connected ? "connected" : ""}`}
                  />
                  <span>
                    {connection?.connected
                      ? "MarketCheck connected · current retail listings"
                      : "Live market feed not connected · add listings from your research"}
                  </span>
                  {connection?.connected && connection.canSearch && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={marketBusy}
                      onClick={() => void marketSearch()}
                    >
                      {marketBusy ? "Searching…" : "Fetch market listings"}
                    </button>
                  )}
                </div>
                {retail && (
                  <div className="valuation-range">
                    <div>
                      <small>
                        Included retail asking · {retail.count} vehicles
                      </small>
                      <strong>
                        {money(retail.low)} – {money(retail.high)}
                      </strong>
                    </div>
                    <div>
                      <small>Median asking price</small>
                      <strong>{money(retail.median)}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        change({
                          target_value: retail.median,
                          disposition: "retail",
                        });
                        setTab("offer");
                      }}
                    >
                      Use median as retail target
                    </button>
                  </div>
                )}
                <p className="valuation-help">
                  The range uses only checked retail asking prices.
                  Private-party, wholesale and completed sales stay separate.
                  Asking prices are not proof of a sale.
                </p>
                {data.comparables.map((c, index) => (
                  <ComparableEditor
                    key={c.id}
                    c={c}
                    index={index}
                    onChange={(p) =>
                      change({
                        comparables: data.comparables.map((x) =>
                          x.id === c.id ? { ...x, ...p } : x,
                        ),
                      })
                    }
                    onRemove={() =>
                      change({
                        comparables: data.comparables.filter(
                          (x) => x.id !== c.id,
                        ),
                      })
                    }
                  />
                ))}
                {!data.comparables.length && (
                  <p className="valuation-inline-empty">
                    Save the asking price, mileage, source link and date for
                    each comparable.
                  </p>
                )}
                <div className="valuation-section-title">
                  <History size={20} />
                  <div>
                    <h3>Drive Max history</h3>
                    <p>
                      Same make and model, within three model years. Review
                      trim, mileage and condition before comparing.
                    </p>
                  </div>
                </div>
                {!history.length && (
                  <p className="valuation-inline-empty">
                    No matching completed sales or current inventory available.
                    As Drive Max sells more of these vehicles, its history will
                    appear here.
                  </p>
                )}
                <div className="valuation-history">
                  {history.slice(0, 20).map((c) => (
                    <div key={c.id}>
                      <div>
                        <strong>{c.vehicle}</strong>
                        <small>
                          {compLabels[c.basis]} · {c.date} ·{" "}
                          {c.mileage?.toLocaleString() ?? "—"} miles
                        </small>
                        <small>{c.notes}</small>
                      </div>
                      <strong>{money(c.price)}</strong>
                      <button
                        type="button"
                        className="btn small"
                        disabled={data.comparables.some((x) => x.id === c.id)}
                        onClick={() => addComparable(c)}
                      >
                        {data.comparables.some((x) => x.id === c.id)
                          ? "Added"
                          : "Use comparable"}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn valuation-next"
                  onClick={() => setTab("offer")}
                >
                  Work out the offer <ArrowUpRight size={15} />
                </button>
              </section>
            )}
            {tab === "offer" && (
              <section
                role="tabpanel"
                id="valuation-panel-offer"
                aria-labelledby="valuation-tab-offer"
              >
                <div className="valuation-section-title">
                  <Wrench size={20} />
                  <div>
                    <h3>What will it take?</h3>
                    <p>
                      Work backward from the expected selling price to your
                      buying limit.
                    </p>
                  </div>
                </div>
                <div className="valuation-grid">
                  <label>
                    Planned exit
                    <select
                      aria-label="Planned exit"
                      value={data.disposition}
                      onChange={(e) =>
                        change({
                          disposition: e.target
                            .value as AppraisalData["disposition"],
                        })
                      }
                    >
                      <option value="retail">Retail on our lot</option>
                      <option value="wholesale">Wholesale / auction</option>
                    </select>
                  </label>
                  <NumberField
                    label={`Expected ${data.disposition} selling price`}
                    n={data.target_value}
                    nullable
                    onChange={(target_value) => change({ target_value })}
                  />
                  <NumberField
                    label="Target vehicle gross profit"
                    n={data.target_profit}
                    onChange={(n) => change({ target_profit: n || 0 })}
                  />
                  <NumberField
                    label="Proposed ACV / purchase offer"
                    n={data.proposed_acv}
                    nullable
                    onChange={(proposed_acv) => change({ proposed_acv })}
                  />
                </div>
                <div className="valuation-subhead">
                  <h3>Reconditioning estimate</h3>
                  <button
                    type="button"
                    className="btn small"
                    disabled={data.recon.length >= 30}
                    onClick={() =>
                      change({
                        recon: [
                          ...data.recon,
                          { id: crypto.randomUUID(), label: "", amount: 0 },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Add recon item
                  </button>
                </div>
                {!data.recon.length && (
                  <p className="valuation-inline-empty">
                    Add tires, brakes, detail, body work or any other work this
                    vehicle needs.
                  </p>
                )}
                {data.recon.map((r, i) => (
                  <div key={r.id} className="valuation-recon">
                    <label>
                      Work item {i + 1}
                      <input
                        placeholder="Tires, brakes, detail…"
                        value={r.label}
                        onChange={(e) =>
                          change({
                            recon: data.recon.map((x) =>
                              x.id === r.id
                                ? { ...x, label: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <NumberField
                      label="Estimated cost"
                      n={r.amount}
                      onChange={(amount) =>
                        change({
                          recon: data.recon.map((x) =>
                            x.id === r.id ? { ...x, amount: amount || 0 } : x,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove recon item ${i + 1}`}
                      onClick={() =>
                        change({
                          recon: data.recon.filter((x) => x.id !== r.id),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <div className="valuation-grid three">
                  <NumberField
                    label="Buyer / auction fee"
                    n={data.buyer_fee}
                    onChange={(n) => change({ buyer_fee: n || 0 })}
                  />
                  <NumberField
                    label="Transport"
                    n={data.transport}
                    onChange={(n) => change({ transport: n || 0 })}
                  />
                  <NumberField
                    label="Other / holding costs"
                    n={data.other_cost}
                    onChange={(n) => change({ other_cost: n || 0 })}
                  />
                </div>
                <label>
                  Valuation notes
                  <textarea
                    maxLength={4000}
                    value={data.notes}
                    onChange={(e) => change({ notes: e.target.value })}
                    placeholder="Why this offer makes sense, comparable adjustments, risks, seller expectations…"
                  />
                </label>
                <p className="valuation-help">
                  Profit shown is vehicle gross before commissions, doc fees,
                  taxes and F&I. Recon estimates stay in this appraisal.
                  Applying ACV updates the trade’s working cost; it does not
                  change allowance, payoff or saved quotes.
                </p>
              </section>
            )}
          </fieldset>
          <div className="valuation-savebar">
            {editable && (
              <>
                <button
                  type="submit"
                  className="btn valuation-primary"
                  disabled={busy || conflict}
                >
                  Save appraisal
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || conflict}
                  onClick={() => void save("review")}
                >
                  Send for review
                </button>
                {record && record.status !== "archived" && (
                  <button
                    type="button"
                    className="text-btn muted"
                    disabled={busy || conflict || dirty}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Archive this appraisal? Its saved research will remain in History.",
                        )
                      )
                        void action(
                          {
                            type: "archive_appraisal",
                            id: record.id,
                            revision,
                          },
                          "Appraisal archived",
                        );
                    }}
                  >
                    Archive
                  </button>
                )}
              </>
            )}
            <small>
              {dirty
                ? "Unsaved changes"
                : record
                  ? `Saved · revision ${record.revision}`
                  : "Not saved yet"}
            </small>
          </div>
        </form>
        <aside className="valuation-offer">
          <div className="valuation-offer-card">
            <span className="valuation-eyebrow">
              <Gauge size={15} /> YOUR BUYING LIMIT
            </span>
            <small>Maximum buy to meet your target</small>
            <strong className="valuation-max">{value(stats.maxBuy)}</strong>
            <p>Expected selling price − costs − target profit</p>
            <dl>
              <div>
                <dt>Expected {data.disposition} price</dt>
                <dd>{value(data.target_value)}</dd>
              </div>
              <div>
                <dt>Reconditioning</dt>
                <dd>− {value(stats.recon)}</dd>
              </div>
              <div>
                <dt>Fees, transport & other</dt>
                <dd>
                  − {value(data.buyer_fee + data.transport + data.other_cost)}
                </dd>
              </div>
              <div>
                <dt>Target vehicle gross</dt>
                <dd>− {value(data.target_profit)}</dd>
              </div>
            </dl>
            {stats.maxBuy !== null && stats.maxBuy < 0 && (
              <p className="valuation-offer-warning">
                The expected sale price does not cover costs and target profit.
              </p>
            )}
          </div>
          <div className="valuation-profit-card">
            <span>At your proposed offer</span>
            <strong>{value(data.proposed_acv)}</strong>
            <dl>
              <div>
                <dt>Total invested</dt>
                <dd>{value(stats.invested)}</dd>
              </div>
              <div>
                <dt>Projected vehicle gross</dt>
                <dd
                  className={
                    stats.projectedProfit !== null &&
                    stats.projectedProfit < data.target_profit
                      ? "below-target"
                      : "on-target"
                  }
                >
                  {value(stats.projectedProfit)}
                </dd>
              </div>
            </dl>
            {stats.maxBuy !== null && data.proposed_acv !== null && (
              <p
                className={
                  data.proposed_acv > stats.maxBuy
                    ? "below-target"
                    : "on-target"
                }
              >
                {data.proposed_acv > stats.maxBuy
                  ? `${money(data.proposed_acv - stats.maxBuy)} above your buying limit`
                  : `${money(stats.maxBuy - data.proposed_acv)} below your buying limit`}
              </p>
            )}
          </div>
          {o?.trade && (
            <div className="valuation-linked-trade">
              <h3>Current deal figures</h3>
              <dl>
                <div>
                  <dt>Working ACV</dt>
                  <dd>{money(o.trade.acv)}</dd>
                </div>
                <div>
                  <dt>Trade allowance</dt>
                  <dd>{money(o.trade.allowance)}</dd>
                </div>
                <div>
                  <dt>Payoff</dt>
                  <dd>{money(o.trade.payoff)}</dd>
                </div>
              </dl>
            </div>
          )}
          {manager && editable && (
            <div className="valuation-approval">
              <h3>
                <BadgeCheck size={18} /> Manager decision
              </h3>
              <p>
                Save the research and offer before approving. Changes to a saved
                appraisal require a new approval.
              </p>
              <button
                className="btn success"
                disabled={
                  busy ||
                  !saved ||
                  data.proposed_acv === null ||
                  data.target_value === null ||
                  mismatch ||
                  record?.status === "archived" ||
                  record?.status === "valued"
                }
                onClick={() =>
                  void action(
                    { type: "approve_appraisal", id: selection.id, revision },
                    "Valuation approved",
                  )
                }
              >
                Approve valuation
              </button>
              {o && (
                <button
                  className="btn valuation-primary"
                  disabled={
                    busy ||
                    !saved ||
                    record?.status !== "valued" ||
                    !!record.applied_at ||
                    mismatch
                  }
                  onClick={() =>
                    void action(
                      {
                        type: "apply_appraisal",
                        id: selection.id,
                        revision,
                        opportunity_updated_at: o.updated_at,
                      },
                      "Approved ACV applied to the trade",
                    )
                  }
                >
                  {record?.applied_at ? (
                    <>
                      <Check size={15} /> ACV applied
                    </>
                  ) : (
                    "Apply approved ACV to trade"
                  )}
                </button>
              )}
            </div>
          )}
          {record?.reviewed_at && (
            <p className="valuation-reviewed">
              <Check size={14} /> Approved by {record.reviewed_name} ·{" "}
              {dayKey(record.reviewed_at)}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="valuation-notice" role="status">
              {notice}
            </p>
          )}
        </aside>
      </div>
      {printing && (
        <PrintDocument onClose={() => setPrinting(false)}>
          <AppraisalPrint
            data={data}
            org={ws.org.name}
            customer={customer?.name}
            source={source}
            record={record}
            dirty={dirty}
          />
        </PrintDocument>
      )}
    </div>
  );
}

function ComparableEditor({
  c,
  index,
  onChange,
  onRemove,
}: {
  c: Comparable;
  index: number;
  onChange: (p: Partial<Comparable>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="valuation-research-row">
      <div className="valuation-subhead">
        <label className="valuation-check">
          <input
            type="checkbox"
            checked={c.included}
            onChange={(e) => onChange({ included: e.target.checked })}
          />{" "}
          Include in comparisons
        </label>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Remove comparable ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="valuation-grid">
        <label>
          Comparable vehicle
          <input
            value={c.vehicle}
            onChange={(e) => onChange({ vehicle: e.target.value })}
          />
        </label>
        <label>
          Price basis
          <select
            aria-label="Price basis"
            value={c.basis}
            onChange={(e) =>
              onChange({ basis: e.target.value as Comparable["basis"] })
            }
          >
            {Object.entries(compLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Comparable price"
          n={c.price}
          onChange={(n) => onChange({ price: n || 0 })}
        />
        <NumberField
          label="Comparable mileage"
          n={c.mileage}
          nullable
          integer
          max={3000000}
          onChange={(mileage) => onChange({ mileage })}
        />
        <label>
          Source / dealership
          <input
            value={c.source}
            onChange={(e) => onChange({ source: e.target.value })}
          />
        </label>
        <label>
          Price date
          <input
            type="date"
            value={c.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </label>
      </div>
      <label>
        Listing / source URL
        <input
          type="url"
          value={c.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://…"
        />
      </label>
      <label>
        Comparison notes
        <input
          maxLength={500}
          value={c.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Trim, condition, mileage differences, fees…"
        />
      </label>
      {c.url && <ResearchLink href={c.url}>Open source</ResearchLink>}
    </div>
  );
}
function AppraisalPrint({
  data: d,
  org,
  customer,
  source,
  record,
  dirty,
}: {
  data: AppraisalData;
  org: string;
  customer?: string;
  source: Appraisal["source"];
  record?: Appraisal;
  dirty: boolean;
}) {
  const m = appraisalMath(d);
  return (
    <div className="valuation-print">
      <header>
        <div>
          <span>INTERNAL · VEHICLE VALUATION</span>
          <h1>{org}</h1>
        </div>
        <div>
          {dayKey()}
          <br />
          {dirty || !record
            ? "Working draft — unsaved"
            : `${statusLabel[record.status]} · revision ${record.revision}`}
        </div>
      </header>
      <h2>{vehicleName(d.vehicle) || "Vehicle details pending"}</h2>
      <p>
        {sourceLabels[source]}
        {customer ? ` · ${customer}` : ""}
        <br />
        VIN {d.vehicle.vin || "—"} ·{" "}
        {d.vehicle.mileage?.toLocaleString() ?? "—"} miles · ZIP {d.zip}
        <br />
        Condition: {d.condition} · Title: {d.title}
      </p>
      <p>{d.description}</p>
      <div className="valuation-print-grid">
        <section>
          <h3>Offer worksheet</h3>
          <dl>
            <div>
              <dt>Expected {d.disposition} selling price</dt>
              <dd>{value(d.target_value)}</dd>
            </div>
            {d.recon.map((r) => (
              <div key={r.id}>
                <dt>Recon · {r.label}</dt>
                <dd>{value(r.amount)}</dd>
              </div>
            ))}
            <div>
              <dt>Buyer / auction fee</dt>
              <dd>{value(d.buyer_fee)}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{value(d.transport)}</dd>
            </div>
            <div>
              <dt>Other / holding costs</dt>
              <dd>{value(d.other_cost)}</dd>
            </div>
            <div>
              <dt>Target vehicle gross</dt>
              <dd>{value(d.target_profit)}</dd>
            </div>
            <div className="valuation-print-total">
              <dt>Maximum buy</dt>
              <dd>{value(m.maxBuy)}</dd>
            </div>
            <div>
              <dt>Proposed ACV / offer</dt>
              <dd>{value(d.proposed_acv)}</dd>
            </div>
            <div>
              <dt>Total invested</dt>
              <dd>{value(m.invested)}</dd>
            </div>
            <div className="valuation-print-total">
              <dt>Projected vehicle gross</dt>
              <dd>{value(m.projectedProfit)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Inspection & rationale</h3>
          <p className="valuation-preserve">
            {d.inspection_notes || "No inspection notes recorded."}
          </p>
          <p className="valuation-preserve">{d.notes}</p>
          {record?.reviewed_at && !dirty && (
            <p>
              Approved by {record.reviewed_name} on {dayKey(record.reviewed_at)}
              {record.applied_at
                ? ` · Applied ${dayKey(record.applied_at)}`
                : " · Not applied to a deal"}
            </p>
          )}
        </section>
      </div>
      <h3>Book values · entered by staff</h3>
      {d.books.length ? (
        <table>
          <thead>
            <tr>
              <th>Source / date</th>
              <th>Basis</th>
              <th>Condition</th>
              <th>Value / range</th>
            </tr>
          </thead>
          <tbody>
            {d.books.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.source} · {b.date}
                </td>
                <td>{basisLabels[b.basis]}</td>
                <td>{b.condition}</td>
                <td>
                  {value(b.low)}
                  {b.high === null ? "" : ` – ${value(b.high)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No book values recorded.</p>
      )}
      <h3>Comparable vehicles</h3>
      {d.comparables.length ? (
        <table>
          <thead>
            <tr>
              <th>Vehicle / source</th>
              <th>Basis / date</th>
              <th>Miles</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {d.comparables.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.vehicle}
                  <small>
                    {c.source}
                    {!c.included ? " · Excluded" : ""}
                  </small>
                </td>
                <td>
                  {compLabels[c.basis]}
                  <small>{c.date}</small>
                </td>
                <td>{c.mileage?.toLocaleString() ?? "—"}</td>
                <td>{money(c.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No comparable vehicles recorded.</p>
      )}
      <footer>
        Internal estimate, not a customer purchase agreement. Asking prices are
        not completed sale values. Vehicle gross excludes commissions, doc fees,
        taxes and F&I. Approval applies only to this saved revision.
      </footer>
    </div>
  );
}
