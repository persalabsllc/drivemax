"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  CircleDollarSign,
  FileCheck2,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  appraisalNumbers,
  appraisalSchema,
  compSchema,
  newAppraisal,
  subjectSchema,
  adjustedCompPrice,
  type Appraisal,
  type MarketSnapshot,
  type SavedAppraisal,
  type Subject,
} from "../../lib/appraisal";
import {
  normalizeVin,
  VIN_PATTERN,
  type DecodedVehicle,
} from "../../lib/vehicle-data";
import { DEALER_ADMINISTRATION_FEE } from "../../lib/vehicle-pricing";

export type AppraisalVehicle = {
  id: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  miles: number;
  drivetrain: string;
  stock_number: string;
  internet_price: number;
  updated_at: string;
  status: string;
};
type Draft = Omit<Appraisal, "subject"> & {
  subject: Omit<Subject, "year" | "miles"> & {
    year: number | null;
    miles: number | null;
  };
};
const usd = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
const numeric = (value: string) => (value === "" ? null : Number(value));
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dated = (value: string) =>
  new Date(
    value.length === 10 ? value + "T12:00:00Z" : value,
  ).toLocaleDateString("en-US", { timeZone: "America/New_York" });
const title = (s: Draft["subject"]) =>
  [s.year, s.make, s.model, s.trim].filter(Boolean).join(" ");
function blank(vehicle?: AppraisalVehicle): Draft {
  const data = newAppraisal();
  return {
    ...data,
    purpose: vehicle ? "inventory" : "trade",
    subject: {
      ...data.subject,
      year: vehicle?.year ?? null,
      miles: vehicle?.miles ?? null,
      vin: vehicle?.vin || "",
      make: vehicle?.make || "",
      model: vehicle?.model || "",
      trim: vehicle?.trim || "",
      drivetrain: vehicle?.drivetrain || "",
    },
  };
}
async function api(body?: Record<string, unknown>) {
  const response = await fetch(
    "/api/control-room/appraisals",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Appraisal request failed. Try again.");
  return data;
}
function Amount({
  label,
  value,
  onChange,
  signed = false,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  signed?: boolean;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        disabled={disabled}
        min={signed ? -2000000 : 0}
        max={2000000}
        step="0.01"
        value={value ?? ""}
        onChange={(e) => onChange(numeric(e.target.value))}
      />
    </label>
  );
}

export default function AppraisalWorkspace({
  vehicles: initialVehicles,
  initialVehicleId,
  isOwner,
}: {
  vehicles: AppraisalVehicle[];
  initialVehicleId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [vehicles, setVehicles] = useState(initialVehicles);
  const initialVehicle = initialVehicles.find((v) => v.id === initialVehicleId);
  const [draft, setDraft] = useState<Draft>(() => blank(initialVehicle));
  const [saved, setSaved] = useState<SavedAppraisal | null>(null);
  const [records, setRecords] = useState<SavedAppraisal[]>([]);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [confirmPrice, setConfirmPrice] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [comp, setComp] = useState({
    title: "",
    price: "",
    miles: "",
    kind: "asking",
    source: "",
    date: today(),
    url: "",
    confirmed: false,
  });
  const [historySearch, setHistorySearch] = useState("");
  const linkedVehicle = vehicles.find((v) => v.vin === draft.subject.vin);
  const dataForNumbers = {
    ...draft,
    subject: {
      ...draft.subject,
      year: draft.subject.year ?? 0,
      miles: draft.subject.miles ?? 0,
    },
  } as Appraisal;
  const numbers = appraisalNumbers(dataForNumbers);
  const allComps = [
    ...(numbers.marketCurrent ? draft.market!.listings : []),
    ...draft.manualComps,
    ...draft.internalSales,
  ];
  const canApply =
    !!saved &&
    !dirty &&
    !!linkedVehicle &&
    ["draft", "available", "pending"].includes(linkedVehicle.status) &&
    numbers.retail !== null &&
    numbers.retail > 0;
  useEffect(() => {
    let active = true;
    api()
      .then((data) => {
        if (active) {
          setRecords(data.records);
          setConnected(data.connected);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(update: (value: Draft) => Draft) {
    setDraft(update);
    setDirty(true);
    setConfirmPrice(false);
    setNotice("");
  }
  function subjectField<K extends keyof Draft["subject"]>(
    name: K,
    value: Draft["subject"][K],
  ) {
    edit((current) => {
      if (name === "vin" && value !== current.subject.vin) {
        const empty = blank();
        return {
          ...current,
          subject: {
            ...current.subject,
            vin: value as string,
            year: null,
            make: "",
            model: "",
            trim: "",
            drivetrain: "",
          },
          book: empty.book,
          manualComps: [],
          excludedCompIds: [],
          internalSales: [],
          sale: empty.sale,
          retailOverride: null,
          market: null,
          costs: { ...current.costs, acquisition: null, retailAdjustment: 0 },
          notes: "",
          condition: "average",
          titleStatus: "unknown",
        };
      }
      return {
        ...current,
        subject: { ...current.subject, [name]: value },
        internalSales: [],
      };
    });
    if (name === "vin") setSaved(null);
  }
  function reset(vehicle?: AppraisalVehicle) {
    if (dirty && !window.confirm("Discard unsaved worksheet changes?")) return;
    setDraft(blank(vehicle));
    setSaved(null);
    setDirty(false);
    setConfirmPrice(false);
    setError("");
    setNotice("");
  }
  function loadRecord(record: SavedAppraisal) {
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved worksheet changes and open this appraisal?",
      )
    )
      return;
    setSaved(record);
    setDraft(record.data);
    setDirty(false);
    setConfirmPrice(false);
    setError("");
    setNotice("");
  }
  async function operation(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Try again. Your edits are still here.",
      );
    } finally {
      setBusy("");
    }
  }
  function checkedSubject() {
    const parsed = subjectSchema.safeParse(draft.subject);
    if (!parsed.success)
      throw new Error(
        "Enter VIN, mileage, year, make, model, and a five-digit ZIP code. Decode the VIN or enter vehicle details below.",
      );
    return parsed.data;
  }
  const setCost = (name: keyof Appraisal["costs"], value: number | null) =>
    edit((current) => ({
      ...current,
      costs: {
        ...current.costs,
        [name]: name === "acquisition" ? value : (value ?? 0),
      },
    }));
  const setBook = (
    name: keyof Appraisal["book"],
    value: string | number | null,
  ) =>
    edit((current) => ({
      ...current,
      book: { ...current.book, [name]: value },
    }));
  function addComp() {
    try {
      if (comp.kind === "sold" && !comp.confirmed)
        throw new Error("Confirm that this is a documented completed sale.");
      const parsed = compSchema.safeParse({
        id: crypto.randomUUID(),
        title: comp.title,
        price: Number(comp.price),
        miles: numeric(comp.miles),
        kind: comp.kind,
        source: comp.source,
        date: comp.date,
        url: comp.url,
        origin: "manual",
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues[0]?.message || "Check the comparable fields.",
        );
      if (!comp.price || Number(comp.price) <= 0 || comp.date > today())
        throw new Error(
          "Enter a positive vehicle price and a date that is today or earlier.",
        );
      if (draft.manualComps.length >= 100)
        throw new Error("This appraisal already has 100 manual comparables.");
      edit((current) => ({
        ...current,
        manualComps: [...current.manualComps, parsed.data],
      }));
      setComp({
        title: "",
        price: "",
        miles: "",
        kind: "asking",
        source: "",
        date: today(),
        url: "",
        confirmed: false,
      });
      setShowComp(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the comparable fields.");
    }
  }
  return (
    <div className="av-workspace">
      <section className="cr-panel av-intro">
        <div>
          <span className="kicker">Appraisals & pricing</span>
          <h2>Know your number before you make your move.</h2>
          <p className="cr-muted">
            Book it. Compare it. Work backward to a buy figure that leaves room
            for profit.
          </p>
        </div>
        <span className={`av-connection ${connected ? "online" : ""}`}>
          <span />
          {connected
            ? "MarketCheck connected"
            : "Manual worksheet · connect market data below"}
        </span>
      </section>

      <section className="cr-panel cr-form av-subject">
        <div className="cr-section-heading">
          <div>
            <span className="kicker">The vehicle</span>
            <h2>{title(draft.subject) || "Start a new appraisal"}</h2>
            {linkedVehicle && (
              <p className="cr-muted">
                Stock {linkedVehicle.stock_number} · Current vehicle price{" "}
                {usd(linkedVehicle.internet_price)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!!busy}
            onClick={() => reset()}
          >
            <Plus size={16} />
            New appraisal
          </button>
        </div>
        <fieldset disabled={!!busy} className="cr-fieldset">
          <div className="cr-grid three">
            <label className="av-vin">
              VIN
              <input
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={17}
                value={draft.subject.vin}
                onChange={(e) =>
                  subjectField("vin", normalizeVin(e.target.value))
                }
                placeholder="Enter 17-character VIN"
              />
            </label>
            <label>
              Mileage
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={2000000}
                value={draft.subject.miles ?? ""}
                onChange={(e) => subjectField("miles", numeric(e.target.value))}
                placeholder="Current odometer"
              />
            </label>
            <label>
              Use an inventory vehicle
              <select
                value={linkedVehicle?.id || ""}
                onChange={(e) => {
                  const vehicle = vehicles.find((v) => v.id === e.target.value);
                  if (vehicle) reset(vehicle);
                }}
              >
                <option value="">Select inventory…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.stock_number} · {v.year} {v.make} {v.model}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="av-toolbar">
            <button
              type="button"
              className="button button-secondary"
              disabled={!VIN_PATTERN.test(draft.subject.vin)}
              onClick={() =>
                operation("decode", async () => {
                  const response = await fetch(
                    `/api/vehicles/decode?vin=${encodeURIComponent(draft.subject.vin)}`,
                  );
                  const decoded: DecodedVehicle & { error?: string } =
                    await response.json();
                  if (!response.ok)
                    throw new Error(
                      decoded.error ||
                        "VIN lookup failed. Enter details manually.",
                    );
                  edit((current) => ({
                    ...current,
                    subject: {
                      ...current.subject,
                      year: decoded.fields.year
                        ? Number(decoded.fields.year)
                        : current.subject.year,
                      make: decoded.fields.make || current.subject.make,
                      model: decoded.fields.model || current.subject.model,
                      trim: decoded.fields.trim || current.subject.trim,
                      drivetrain:
                        decoded.fields.drivetrain || current.subject.drivetrain,
                    },
                  }));
                  setNotice(
                    decoded.warning ||
                      "VIN decoded. Confirm the trim and equipment before pricing.",
                  );
                })
              }
            >
              <Search size={16} />
              {busy === "decode" ? "Decoding…" : "Decode VIN"}
            </button>
            <label className="av-purpose">
              Appraisal for
              <select
                value={draft.purpose}
                onChange={(e) =>
                  edit((c) => ({
                    ...c,
                    purpose: e.target.value as Appraisal["purpose"],
                  }))
                }
              >
                <option value="trade">Trade-in</option>
                <option value="purchase">Car to buy</option>
                <option value="inventory">Inventory pricing</option>
              </select>
            </label>
            <span className="cr-muted">
              VIN decoding is free. Confirm trim, options, history, and
              condition.
            </span>
          </div>
          <details
            className="av-details"
            open={!draft.subject.make || !draft.subject.model}
          >
            <summary>Vehicle details & market filters</summary>
            <div className="cr-grid three">
              <label>
                Year
                <input
                  type="number"
                  min={1981}
                  max={new Date().getFullYear() + 2}
                  value={draft.subject.year ?? ""}
                  onChange={(e) =>
                    subjectField("year", numeric(e.target.value))
                  }
                />
              </label>
              {(["make", "model", "trim", "drivetrain"] as const).map(
                (name) => (
                  <label key={name}>
                    {name[0].toUpperCase() + name.slice(1)}
                    <input
                      maxLength={name === "trim" ? 100 : 60}
                      value={draft.subject[name]}
                      onChange={(e) => subjectField(name, e.target.value)}
                    />
                  </label>
                ),
              )}
              <label>
                Market ZIP
                <input
                  inputMode="numeric"
                  maxLength={5}
                  value={draft.subject.zip}
                  onChange={(e) => subjectField("zip", e.target.value)}
                />
              </label>
              <label>
                Search radius
                <select
                  value={draft.subject.radius}
                  onChange={(e) =>
                    subjectField("radius", Number(e.target.value))
                  }
                >
                  {[25, 50, 100, 150, 250, 500].map((v) => (
                    <option key={v} value={v}>
                      {v} miles
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Comparable mileage range
                <select
                  value={draft.subject.mileageWindow}
                  onChange={(e) =>
                    subjectField("mileageWindow", Number(e.target.value))
                  }
                >
                  {[10000, 20000, 30000, 50000, 100000, 200000].map((v) => (
                    <option key={v} value={v}>
                      Within ±{v.toLocaleString()} miles
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Match trim
                <select
                  value={String(draft.subject.exactTrim)}
                  onChange={(e) =>
                    subjectField("exactTrim", e.target.value === "true")
                  }
                >
                  <option value="true">Same trim when available</option>
                  <option value="false">All trims · review each comp</option>
                </select>
              </label>
              <label>
                Overall condition
                <select
                  value={draft.condition}
                  onChange={(e) =>
                    edit((c) => ({
                      ...c,
                      condition: e.target.value as Appraisal["condition"],
                    }))
                  }
                >
                  <option value="clean">Clean</option>
                  <option value="average">Average</option>
                  <option value="rough">Rough</option>
                </select>
              </label>
              <label>
                Title status
                <select
                  value={draft.titleStatus}
                  onChange={(e) =>
                    edit((c) => ({
                      ...c,
                      titleStatus: e.target.value as Appraisal["titleStatus"],
                    }))
                  }
                >
                  <option value="clean">Clean title</option>
                  <option value="branded">Branded / rebuilt / salvage</option>
                  <option value="unknown">Not verified</option>
                </select>
              </label>
            </div>
          </details>
          <div className="av-toolbar">
            <button
              type="button"
              className="button button-primary"
              onClick={() =>
                operation("market", async () => {
                  const subject = checkedSubject(),
                    result = await api({ action: "market", subject });
                  edit((current) => ({
                    ...current,
                    market: result.market as MarketSnapshot | null,
                    internalSales: result.ownSales,
                  }));
                  setConnected(result.connected);
                  setNotice(
                    result.message ||
                      "Market lookup complete. Review the comps and exclusions below.",
                  );
                })
              }
            >
              <RefreshCw size={16} />
              {busy === "market"
                ? "Finding comparables…"
                : connected
                  ? "Run market lookup"
                  : "Check recorded sales"}
            </button>
            <span className="cr-muted">
              Default market: New Bern, NC 28562 · Same model year
            </span>
          </div>
          <p className="cr-muted">
            Live comps use non-CPO listings reported with clean titles. AWD and
            4WD share a search group; confirm the exact drive system on each
            comp.
          </p>
        </fieldset>
      </section>

      {draft.market && !numbers.marketCurrent && (
        <p className="av-warning">
          Vehicle details or filters changed. Run a fresh lookup; the previous
          market data is excluded from calculations.
        </p>
      )}
      {draft.titleStatus !== "clean" && (
        <p className="av-warning">
          {draft.titleStatus === "branded"
            ? "Branded-title vehicle"
            : "Title not verified"}
          : clean-title comps can overstate value. Review the history and enter
          a retail override before updating inventory.
        </p>
      )}
      {numbers.marketCurrent &&
        Date.now() - Date.parse(draft.market!.fetchedAt) > 86400000 && (
          <p className="av-warning">
            This saved market snapshot is more than a day old. Run a fresh
            market lookup before making a new buy or retail pricing decision.
          </p>
        )}
      {draft.market?.warnings.map((w, i) => (
        <p className="av-warning" key={i}>
          {w}
        </p>
      ))}
      <div className="av-stat-grid">
        <article className="av-stat">
          <BarChart3 size={20} />
          <span>Market retail estimate</span>
          <strong>{usd(numbers.predictedPrice)}</strong>
          <small>
            {numbers.predictedPrice !== null
              ? "MarketCheck · VIN, miles & ZIP"
              : "Connect MarketCheck and run lookup"}
          </small>
        </article>
        <article className="av-stat">
          <Search size={20} />
          <span>Comparable asking median</span>
          <strong>{usd(numbers.medianAsk)}</strong>
          <small>
            {numbers.askingCount} included listing
            {numbers.askingCount === 1 ? "" : "s"} · advertised prices
          </small>
        </article>
        <article className="av-stat">
          <FileCheck2 size={20} />
          <span>Recorded sale median</span>
          <strong>{usd(numbers.medianSold)}</strong>
          <small>
            {numbers.soldCount
              ? `${numbers.soldCount} documented/entered sale${numbers.soldCount === 1 ? "" : "s"}`
              : "Add confirmed sales or record a Drive Max sale"}
          </small>
        </article>
        <article className="av-stat av-stat-primary">
          <CircleDollarSign size={20} />
          <span>Maximum buy / trade figure</span>
          <strong>{usd(numbers.maxBuy)}</strong>
          <small>After recon, costs, allowance & target profit</small>
        </article>
      </div>

      <div className="av-main-grid">
        <section className="cr-panel cr-form">
          <div className="cr-section-heading">
            <div>
              <span className="kicker">Retail position</span>
              <h2>Your asking price</h2>
            </div>
            <SlidersHorizontal size={22} />
          </div>
          <fieldset disabled={!!busy} className="cr-fieldset">
            <div
              className="av-strategies"
              role="group"
              aria-label="Pricing strategy"
            >
              {(
                [
                  ["quick", "Move it", "25th percentile"],
                  ["balanced", "Competitive", "Market midpoint"],
                  ["margin", "Hold for margin", "75th percentile"],
                ] as const
              ).map(([value, label, help]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.strategy === value}
                  onClick={() => edit((c) => ({ ...c, strategy: value }))}
                >
                  <strong>{label}</strong>
                  <small>{help}</small>
                </button>
              ))}
            </div>
            <div className="av-retail">
              <span>Suggested vehicle price</span>
              <strong>{usd(numbers.retail)}</strong>
              <p>{numbers.basis}</p>
              {numbers.rank !== null && (
                <span className="av-rank">
                  Price rank {numbers.rank} of {numbers.rankTotal} including
                  this vehicle
                </span>
              )}
            </div>
            <div className="cr-grid">
              <Amount
                label="Your retail override ($)"
                value={draft.retailOverride}
                onChange={(value) =>
                  edit((c) => ({ ...c, retailOverride: value }))
                }
              />
              <Amount
                label="Condition / equipment adjustment ($)"
                signed
                value={draft.costs.retailAdjustment}
                onChange={(v) => setCost("retailAdjustment", v)}
              />
            </div>
            <p className="cr-muted">
              A negative adjustment lowers the target. Condition labels alone do
              not change value. Strategies use the included asking-price sample;
              with a market estimate only, Move it / Hold for margin applies −3%
              / +3%.
            </p>
            <div className="av-total">
              <span>Website total with dealer administration fee</span>
              <strong>
                {usd(
                  numbers.retail === null
                    ? null
                    : numbers.retail + DEALER_ADMINISTRATION_FEE,
                )}
              </strong>
              <small>
                Tax and tags extra. Price rank compares vehicle prices;
                competitor fees may differ.
              </small>
            </div>
            {numbers.askingCount < 3 && (
              <p className="av-warning">
                {numbers.askingCount
                  ? "Limited comparable sample. Review listings and add more evidence before committing."
                  : "No asking-price sample yet. Add comps, a book retail value, or your own price to work the deal."}
              </p>
            )}
            {linkedVehicle && (
              <div className="av-inventory-price">
                <span>
                  Inventory vehicle price:{" "}
                  <strong>{usd(linkedVehicle.internet_price)}</strong>
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!canApply}
                  onClick={() => setConfirmPrice(true)}
                >
                  Use target for inventory
                </button>
                {!canApply && (
                  <small>
                    Save the worksheet before applying a price. Sold and
                    archived vehicles cannot be repriced here.
                  </small>
                )}
              </div>
            )}
            {confirmPrice && linkedVehicle && (
              <div
                className="av-confirm"
                role="group"
                aria-label="Confirm inventory price"
              >
                <strong>
                  Update stock {linkedVehicle.stock_number} to{" "}
                  {usd(numbers.retail)}?
                </strong>
                <p>
                  The website total will be{" "}
                  {usd(numbers.retail! + DEALER_ADMINISTRATION_FEE)}, plus tax
                  and tags.
                </p>
                <div className="av-toolbar">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() =>
                      operation("price", async () => {
                        const result = await api({
                          action: "applyPrice",
                          id: saved!.id,
                          vehicleUpdatedAt: linkedVehicle.updated_at,
                          expectedPrice: numbers.retail,
                        });
                        setVehicles((list) =>
                          list.map((v) =>
                            v.id === result.vehicle.id
                              ? { ...v, ...result.vehicle }
                              : v,
                          ),
                        );
                        setConfirmPrice(false);
                        setNotice(result.message);
                        router.refresh();
                      })
                    }
                  >
                    Update website price
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setConfirmPrice(false)}
                  >
                    Keep current price
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        </section>

        <section className="cr-panel cr-form">
          <span className="kicker">Work the deal backward</span>
          <h2>Leave room to make money.</h2>
          <fieldset disabled={!!busy} className="cr-fieldset">
            <div className="cr-grid">
              {(
                [
                  ["recon", "Reconditioning ($)"],
                  ["fees", "Auction / other costs ($)"],
                  ["transport", "Transport ($)"],
                  ["profit", "Target front-end profit ($)"],
                  ["reserve", "Negotiation allowance ($)"],
                  ["acquisition", "Buy price / trade ACV ($)"],
                ] as const
              ).map(([name, label]) => (
                <Amount
                  key={name}
                  label={label}
                  value={draft.costs[name]}
                  onChange={(v) => setCost(name, v)}
                />
              ))}
            </div>
          </fieldset>
          <dl className="av-deal-lines">
            <div>
              <dt>Target vehicle price</dt>
              <dd>{usd(numbers.retail)}</dd>
            </div>
            <div>
              <dt>Less negotiation allowance</dt>
              <dd>{usd(draft.costs.reserve)}</dd>
            </div>
            <div>
              <dt>Expected sale · worksheet assumption</dt>
              <dd>{usd(numbers.expectedSale)}</dd>
            </div>
            <div>
              <dt>Less recon + costs + transport</dt>
              <dd>{usd(numbers.expenses)}</dd>
            </div>
            <div>
              <dt>Less target front-end profit</dt>
              <dd>{usd(draft.costs.profit)}</dd>
            </div>
            <div className="av-buy-line">
              <dt>Maximum buy / trade ACV</dt>
              <dd>{usd(numbers.maxBuy)}</dd>
            </div>
            {numbers.allIn !== null && (
              <>
                <div>
                  <dt>All-in at your buy figure</dt>
                  <dd>{usd(numbers.allIn)}</dd>
                </div>
                <div
                  className={
                    numbers.gross !== null && numbers.gross < draft.costs.profit
                      ? "av-shortfall"
                      : ""
                  }
                >
                  <dt>Projected front-end gross</dt>
                  <dd>{usd(numbers.gross)}</dd>
                </div>
              </>
            )}
          </dl>
          <p className="cr-muted">
            Buy limit rounds down to the nearest $50. Front-end worksheet
            excludes tax, tags, financing income, dealer fee income, and ongoing
            overhead. Defaults are editable starting assumptions.
          </p>
          {numbers.rawMaxBuy !== null && numbers.rawMaxBuy < 0 && (
            <p className="av-warning">
              This target cannot cover the entered costs and profit, even with a
              $0 acquisition price.
            </p>
          )}
          {numbers.gross !== null && numbers.gross < draft.costs.profit && (
            <p className="av-warning">
              Your buy figure leaves {usd(draft.costs.profit - numbers.gross)}{" "}
              less than the target front-end profit.
            </p>
          )}
        </section>
      </div>

      <section className="cr-panel cr-form">
        <div className="cr-section-heading">
          <div>
            <span className="kicker">Licensed book reference</span>
            <h2>What does it book for?</h2>
            <p className="cr-muted">
              Enter mileage- and equipment-adjusted values from your J.D. Power,
              Black Book, KBB, or auction valuation. These are manual
              references.
            </p>
          </div>
          <span className="cr-badge">Manual book entry</span>
        </div>
        <fieldset disabled={!!busy} className="cr-fieldset">
          <div className="cr-grid three">
            <label>
              Book / reference source
              <input
                list="av-book-sources"
                value={draft.book.source}
                onChange={(e) => setBook("source", e.target.value)}
                maxLength={120}
                placeholder="J.D. Power, Black Book, MMR…"
              />
              <datalist id="av-book-sources">
                <option value="J.D. Power" />
                <option value="Black Book" />
                <option value="Kelley Blue Book" />
                <option value="Manheim MMR" />
              </datalist>
            </label>
            <label>
              Values as of
              <input
                type="date"
                max={today()}
                value={draft.book.asOf}
                onChange={(e) => setBook("asOf", e.target.value)}
              />
            </label>
            <label>
              Comp mileage adjustment ($ / 1,000 mi)
              <input
                type="number"
                min={0}
                max={1000}
                step="1"
                value={draft.costs.mileageAdjustment}
                onChange={(e) =>
                  setCost("mileageAdjustment", numeric(e.target.value))
                }
              />
            </label>
            {(
              [
                ["roughTrade", "Rough trade ($)"],
                ["averageTrade", "Average trade ($)"],
                ["cleanTrade", "Clean trade ($)"],
                ["loan", "Loan value ($)"],
                ["retail", "Book retail ($)"],
                ["wholesale", "Wholesale / auction ($)"],
              ] as const
            ).map(([name, label]) => (
              <Amount
                key={name}
                label={label}
                value={draft.book[name]}
                onChange={(v) => setBook(name, v)}
              />
            ))}
          </div>
        </fieldset>
        <p className="cr-muted">
          No automatic book-feed account is connected. Mileage adjustment
          defaults to $0; changing it adjusts comps to your odometer, not the
          provider estimate or entered book values.
        </p>
      </section>

      <section className="cr-panel cr-form">
        <div className="cr-section-heading">
          <div>
            <span className="kicker">The evidence behind the price</span>
            <h2>Comparable vehicles</h2>
            <p className="cr-muted">
              {numbers.marketCurrent
                ? `${draft.market!.totalFound} search matches · up to 50 nearest listings · fetched ${dated(draft.market!.fetchedAt)} · ZIP ${draft.market!.query.zip}, ${draft.market!.query.radius}-mile radius.`
                : "Add listings and confirmed transactions, or connect live market data."}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!!busy}
            onClick={() => {
              setShowComp((v) => !v);
              setComp((c) => ({
                ...c,
                title: c.title || title(draft.subject),
              }));
            }}
          >
            <Plus size={16} />
            Add comparable
          </button>
        </div>
        <p className="av-evidence-note">
          Asking prices are advertised prices. Recorded sales come from entered
          transaction records; a listing disappearing does not prove its sale
          price. Check trim, drivetrain, equipment, history, and dealer fees
          before including a comp.
        </p>
        {showComp && (
          <div className="av-comp-form">
            <fieldset disabled={!!busy} className="cr-fieldset">
              <div className="cr-grid three">
                <label>
                  Vehicle / trim
                  <input
                    value={comp.title}
                    maxLength={240}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, title: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Price type
                  <select
                    value={comp.kind}
                    onChange={(e) =>
                      setComp((c) => ({
                        ...c,
                        kind: e.target.value,
                        confirmed: false,
                      }))
                    }
                  >
                    <option value="asking">Advertised asking price</option>
                    <option value="sold">Confirmed sale price</option>
                  </select>
                </label>
                <label>
                  Vehicle price ($)
                  <input
                    type="number"
                    min={1}
                    max={2000000}
                    value={comp.price}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, price: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Mileage (optional)
                  <input
                    type="number"
                    min={0}
                    max={2000000}
                    value={comp.miles}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, miles: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Source / evidence
                  <input
                    maxLength={120}
                    value={comp.source}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, source: e.target.value }))
                    }
                    placeholder={
                      comp.kind === "sold"
                        ? "Auction invoice / bill of sale"
                        : "Dealer listing"
                    }
                  />
                </label>
                <label>
                  Observed / sale date
                  <input
                    type="date"
                    max={today()}
                    value={comp.date}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, date: e.target.value }))
                    }
                  />
                </label>
                <label className="av-wide">
                  Source URL (optional)
                  <input
                    type="url"
                    maxLength={2000}
                    value={comp.url}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, url: e.target.value }))
                    }
                    placeholder="https://…"
                  />
                </label>
              </div>
              {comp.kind === "sold" && (
                <label className="cr-check">
                  <input
                    type="checkbox"
                    checked={comp.confirmed}
                    onChange={(e) =>
                      setComp((c) => ({ ...c, confirmed: e.target.checked }))
                    }
                  />
                  I have a completed transaction record for this vehicle price,
                  excluding tax, tags, and dealer fees.
                </label>
              )}
              <div className="av-toolbar">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={addComp}
                >
                  Add to appraisal
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setShowComp(false)}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </div>
        )}
        <div className="cr-table-wrap">
          <table className="cr-table av-comp-table">
            <thead>
              <tr>
                <th>Use</th>
                <th>Vehicle / source</th>
                <th>Price type</th>
                <th>Price</th>
                <th>Mileage</th>
                <th>Distance / days</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {allComps.map((c) => (
                <tr
                  key={c.id}
                  className={
                    draft.excludedCompIds.includes(c.id) ? "av-excluded" : ""
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Include ${c.title}, ${usd(c.price)}`}
                      disabled={!!busy}
                      checked={!draft.excludedCompIds.includes(c.id)}
                      onChange={(e) =>
                        edit((current) => ({
                          ...current,
                          excludedCompIds: e.target.checked
                            ? current.excludedCompIds.filter(
                                (id) => id !== c.id,
                              )
                            : [...current.excludedCompIds, c.id],
                        }))
                      }
                    />
                  </td>
                  <td className="cr-record-title">
                    <strong>{c.title}</strong>
                    {c.url ? (
                      <a
                        className="text-link"
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {c.dealer || c.source} <ArrowUpRight size={12} />
                      </a>
                    ) : (
                      <small>{c.dealer || c.source}</small>
                    )}
                    <small>
                      {c.source} · {dated(c.date)}
                    </small>
                    {c.vin && <small>VIN {c.vin}</small>}
                  </td>
                  <td>
                    <span
                      className={`cr-badge ${c.kind === "sold" ? "available" : "new"}`}
                    >
                      {c.kind === "sold" ? "Recorded sale" : "Asking"}
                    </span>
                  </td>
                  <td>
                    <strong>{usd(c.price)}</strong>
                    {draft.costs.mileageAdjustment > 0 && c.miles !== null && (
                      <small>
                        Adjusted:{" "}
                        {usd(
                          adjustedCompPrice(
                            c,
                            draft.subject.miles ?? 0,
                            draft.costs.mileageAdjustment,
                          ),
                        )}
                      </small>
                    )}
                  </td>
                  <td>{c.miles?.toLocaleString() ?? "—"}</td>
                  <td>
                    {c.distance === null ? "—" : `${Math.round(c.distance)} mi`}
                    <small>
                      {c.daysOnMarket === null
                        ? "Days unavailable"
                        : `${c.daysOnMarket} days listed`}
                    </small>
                  </td>
                  <td>
                    {c.origin === "manual" && (
                      <button
                        type="button"
                        className="av-icon-button"
                        aria-label={`Remove ${c.title}`}
                        disabled={!!busy}
                        onClick={() =>
                          edit((current) => ({
                            ...current,
                            manualComps: current.manualComps.filter(
                              (item) => item.id !== c.id,
                            ),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!allComps.length && (
          <div className="cr-empty">
            <Search size={30} />
            <p>Your comparable vehicles will appear here.</p>
            <small>
              Add a listing or transaction, then see the pricing worksheet
              update.
            </small>
          </div>
        )}
      </section>

      <section className="cr-panel cr-form">
        <div className="cr-grid">
          <label>
            Appraisal notes
            <textarea
              rows={4}
              maxLength={6000}
              value={draft.notes}
              disabled={!!busy}
              onChange={(e) => edit((c) => ({ ...c, notes: e.target.value }))}
              placeholder="Equipment, damage, tires, service history, title/history findings, and why you chose this figure."
            />
          </label>
          <div>
            <h3>Record a completed Drive Max sale</h3>
            <p className="cr-muted">
              Enter the actual vehicle sale price after the deal closes. This
              builds your own 90-day transaction reference for matching
              vehicles.
            </p>
            <div className="cr-grid">
              <Amount
                label="Actual vehicle sale price ($)"
                disabled={!!busy}
                value={draft.sale.price}
                onChange={(v) =>
                  edit((c) => ({ ...c, sale: { ...c.sale, price: v } }))
                }
              />
              <label>
                Sale date
                <input
                  type="date"
                  disabled={!!busy}
                  max={today()}
                  value={draft.sale.date}
                  onChange={(e) =>
                    edit((c) => ({
                      ...c,
                      sale: { ...c.sale, date: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
            <small className="cr-muted">
              Vehicle price only; exclude tax, tags, dealer fees, and finance
              products.
            </small>
          </div>
        </div>
      </section>

      {isOwner && (
        <details className="cr-panel av-connect">
          <summary>
            Market data connection{" "}
            <span className="cr-badge">
              {connected ? "Connected" : "Setup needed"}
            </span>
          </summary>
          <div className="cr-form">
            <h3>Connect a MarketCheck API account</h3>
            <p>
              Choose an account with <strong>Inventory Search</strong> and{" "}
              <strong>MarketCheck Price · US Used Base</strong>. Each lookup
              uses paid account credits. Successful identical lookups reuse
              results for up to six hours.
            </p>
            <p>
              <a
                className="text-link"
                href="https://www.marketcheck.com/apis/"
                target="_blank"
                rel="noopener noreferrer"
              >
                MarketCheck data and API accounts ↗
              </a>
            </p>
            <form
              className="av-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void operation("connect", async () => {
                  const result = await api({ action: "connect", key });
                  setKey("");
                  setConnected(result.connected);
                  setNotice(result.message);
                });
              }}
            >
              <label>
                MarketCheck API key
                <input
                  type="password"
                  autoComplete="off"
                  maxLength={512}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={!!busy}
                  placeholder="Paste your account API key here"
                  required
                />
              </label>
              <button className="button button-primary" disabled={!!busy}>
                {busy === "connect"
                  ? "Checking connection…"
                  : connected
                    ? "Replace connection"
                    : "Connect market data"}
              </button>
            </form>
            <small className="cr-muted">
              The connection check uses one inventory API request. Your key is
              encrypted and never displayed after saving. Book-value and
              confirmed market-wide transaction feeds require their own licensed
              sources.
            </small>
            {connected && (
              <button
                type="button"
                className="text-link av-disconnect"
                disabled={!!busy}
                onClick={() =>
                  operation("disconnect", async () => {
                    const result = await api({ action: "disconnect" });
                    setConnected(false);
                    setNotice(result.message);
                  })
                }
              >
                Disconnect MarketCheck
              </button>
            )}
          </div>
        </details>
      )}

      <div className="cr-savebar av-savebar">
        <span>
          {busy
            ? "Working…"
            : dirty
              ? "Unsaved appraisal"
              : saved
                ? `Saved ${dated(saved.updatedAt)}`
                : "New appraisal"}
        </span>
        <div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!!busy}
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print worksheet
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!!busy}
            onClick={() =>
              operation("save", async () => {
                const parsed = appraisalSchema.safeParse(draft);
                if (!parsed.success)
                  throw new Error(
                    parsed.error.issues[0]?.message ||
                      "Check the appraisal fields.",
                  );
                const result = await api({
                  action: "save",
                  id: saved?.id,
                  updatedAt: saved?.updatedAt,
                  data: parsed.data,
                });
                setSaved(result.record);
                setDraft(result.record.data);
                setRecords((list) =>
                  [
                    result.record,
                    ...list.filter((r) => r.id !== result.record.id),
                  ].slice(0, 200),
                );
                setDirty(false);
                setNotice(result.message);
              })
            }
          >
            <Save size={16} />
            {busy === "save" ? "Saving…" : "Save appraisal"}
          </button>
        </div>
      </div>
      <div className="av-notices" aria-live="polite">
        {error && (
          <p className="cr-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="cr-success" role="status">
            {notice}
          </p>
        )}
      </div>

      <section className="cr-panel cr-form av-history">
        <div className="cr-section-heading">
          <div>
            <span className="kicker">Your valuation history</span>
            <h2>Saved appraisals</h2>
          </div>
          <label>
            Find an appraisal
            <input
              type="search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="VIN, make, model…"
            />
          </label>
        </div>
        {!loaded ? (
          <p className="cr-muted">Loading appraisals…</p>
        ) : !records.length ? (
          <p className="cr-muted">
            Save your first appraisal to keep the figures, notes, book
            references, and market snapshot together.
          </p>
        ) : (
          <div className="cr-table-wrap">
            <table className="cr-table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Purpose</th>
                  <th>Target / max buy</th>
                  <th>Updated</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {records
                  .filter((r) =>
                    `${r.title} ${r.data.subject.vin}`
                      .toLowerCase()
                      .includes(historySearch.toLowerCase()),
                  )
                  .map((r) => {
                    const n = appraisalNumbers(r.data);
                    return (
                      <tr key={r.id}>
                        <td className="cr-record-title">
                          <strong>{r.title}</strong>
                          <small>
                            {r.data.subject.vin} ·{" "}
                            {r.data.subject.miles.toLocaleString()} mi
                          </small>
                        </td>
                        <td>{r.data.purpose}</td>
                        <td>
                          {usd(n.retail)}
                          <small>Buy limit {usd(n.maxBuy)}</small>
                        </td>
                        <td>{dated(r.updatedAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={!!busy}
                            onClick={() => void loadRecord(r)}
                          >
                            Open worksheet
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <small className="cr-muted">
          Most recent 200 appraisals. Saved market snapshots keep the date they
          were retrieved; refresh before making a new purchase decision.
        </small>
      </section>
      {linkedVehicle && (
        <Link
          className="text-link av-back-link"
          href={`/control-room?tab=inventory&vehicle=${linkedVehicle.id}#vehicle-editor`}
        >
          Back to stock {linkedVehicle.stock_number} →
        </Link>
      )}
    </div>
  );
}
