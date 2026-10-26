"use client";
import { useState } from "react";
import { Download, Printer, BarChart3 } from "lucide-react";
import { type Workspace, dayKey, fullMoney, canManage } from "../lib/model";
import {
  saleMath,
  productCostFor,
  sum,
  withinDates,
  productKinds,
  csvText,
  type Sale,
} from "../lib/operations";
import { daysOnHand, vehicleName } from "../lib/vehicles";
import { PrintDocument } from "./PrintDocument";
import { DealRecap } from "./DealRecap";
import type { RunCommand } from "./Communications";
type Report =
  | "sales"
  | "inventory"
  | "products"
  | "trades"
  | "commissions"
  | "wholesale"
  | "unwound";
const names: Record<Report, string> = {
  sales: "Sold deal profit",
  inventory: "Inventory valuation & aging",
  products: "F&I product profit",
  trades: "Trade ACV & allowances",
  commissions: "Commission sheets",
  wholesale: "Wholesale trades",
  unwound: "Unwound deal history",
};
type Row = { id: string; cells: (string | number | null)[]; sale?: Sale };
export function Accounting({
  ws,
  run,
  busy,
}: {
  ws: Workspace;
  run: RunCommand;
  busy: boolean;
}) {
  const manager = canManage(ws.member.role),
    today = dayKey();
  const [report, setReport] = useState<Report>(
      manager ? "sales" : "commissions",
    ),
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [staff, setStaff] = useState(""),
    [age, setAge] = useState(0),
    [printing, setPrinting] = useState(false),
    [recap, setRecap] = useState<string | null>(null);
  const period = (kind: string) => {
    setTo(today);
    setFrom(
      kind === "today"
        ? today
        : kind === "month"
          ? today.slice(0, 7) + "-01"
          : kind === "year"
            ? today.slice(0, 4) + "-01-01"
            : "",
    );
    if (kind === "all") setTo("");
  };
  const allSales = (ws.sales ?? []).filter((s) =>
      withinDates(s.sold_on, from, to),
    ),
    sales = allSales.filter(
      (s) =>
        s.status === "sold" &&
        (!staff ||
          s.snapshot?.salesperson?.id === staff ||
          s.snapshot?.opportunity?.assigned_to === staff),
    );
  let headers: string[] = [],
    rows: Row[] = [],
    metrics: { label: string; value: string }[] = [],
    note = "";
  const fmt = (n: number | null | undefined) =>
    n == null ? "Incomplete" : fullMoney(n);
  if (report === "inventory") {
    headers = [
      "Stock",
      "Vehicle",
      "Status",
      "Acquired",
      "Days",
      "Cost",
      "Recon",
      "Total invested",
      "Asking price",
    ];
    const inventory = ws.inventory
      .filter((v) => ["in_stock", "pending"].includes(v.status))
      .map((v) => ({
        id: v.id,
        stock: v.stock_number,
        name: vehicleName(v),
        status: v.status,
        date: v.acquired_on,
        days: daysOnHand(v.acquired_on, today) ?? 0,
        cost: v.cost,
        recon: v.recon,
        price: v.price,
      }));
    const pending = (ws.trades ?? [])
      .filter((t) => ["received", "wholesale"].includes(t.status))
      .map((t) => ({
        id: t.id,
        stock: t.stock_number,
        name: vehicleName(t),
        status: "trade " + t.status,
        date: t.acquired_on,
        days: daysOnHand(t.acquired_on, today) ?? 0,
        cost: t.cost,
        recon: t.recon,
        price: t.price,
      }));
    const units = [...inventory, ...pending]
      .filter((v) => v.days >= age)
      .sort((a, b) => b.days - a.days);
    rows = units.map((v) => ({
      id: v.id,
      cells: [
        v.stock,
        v.name,
        v.status,
        v.date,
        v.days,
        fmt(v.cost),
        fmt(v.recon),
        fmt(v.cost + v.recon),
        fmt(v.price),
      ],
    }));
    metrics = [
      { label: "Current units", value: String(units.length) },
      { label: "Vehicle cost", value: fmt(sum(units.map((v) => v.cost))) },
      { label: "Recon invested", value: fmt(sum(units.map((v) => v.recon))) },
      {
        label: "Total invested",
        value: fmt(sum(units.map((v) => v.cost + v.recon))),
      },
    ];
    note =
      "Current inventory as of " +
      today +
      ". Includes retail/pending inventory and trade intake awaiting retail or wholesale. Retail trades are counted once. Sold and returned vehicles are excluded.";
  } else if (report === "sales") {
    headers = [
      "Sold",
      "Customer / vehicle",
      "Stock",
      "Front gross",
      "F&I gross",
      "Total gross",
      "Doc fee",
      "Commission earned",
      "Paid to date",
      "Net after commission",
    ];
    const calculated = sales.map((s) => ({
      s,
      m: saleMath(s, ws.commissions),
    }));
    rows = calculated.map(({ s, m }) => ({
      id: s.id,
      sale: s,
      cells: [
        s.sold_on,
        s.snapshot.customer.name +
          " · " +
          (s.snapshot.quote?.vehicle ||
            s.snapshot.opportunity.vehicle_interest),
        s.snapshot.quote?.vehicle_details?.stock_number ??
          s.snapshot.opportunity.vehicle_details?.stock_number ??
          "—",
        fmt(m.front),
        fmt(m.back),
        fmt(m.gross),
        fmt(s.snapshot.quote?.values.docFee),
        fmt(m.earned),
        fmt(m.paid),
        fmt(m.net),
      ],
    }));
    const complete = calculated.filter((x) => x.m.complete);
    metrics = [
      { label: "Sold deals", value: String(sales.length) },
      {
        label: "Gross · complete deals",
        value: fmt(sum(complete.map((x) => x.m.gross!))),
      },
      {
        label: "Commissions earned",
        value: fmt(sum(calculated.map((x) => x.m.earned))),
      },
      {
        label: "Net · complete deals",
        value: fmt(sum(complete.map((x) => x.m.net!))),
      },
    ];
    note = `${calculated.length - complete.length} deal(s) have incomplete accounting and are excluded from gross/net totals. Doc fees are included in front gross. Tax/title collections, payoffs and down payments are not profit. Net excludes dealership overhead. Unwound deals are excluded.`;
  } else if (report === "products") {
    headers = [
      "Sold",
      "Customer",
      "Product / provider",
      "Term months",
      "Mileage limit",
      "Deductible",
      "Retail",
      "Cost",
      "Gross",
    ];
    const products = sales.flatMap((s) =>
      (s.snapshot.quote?.values.products ?? []).map((p) => ({
        s,
        p: { ...p, cost: productCostFor(s, p) },
      })),
    );
    rows = products.map(({ s, p }) => ({
      id: s.id + p.id,
      sale: s,
      cells: [
        s.sold_on,
        s.snapshot.customer.name,
        productKinds[p.kind] + (p.provider ? " · " + p.provider : ""),
        p.term_months,
        p.mileage_limit,
        fmt(p.deductible),
        fmt(p.price),
        fmt(p.cost),
        fmt(p.cost === null ? null : p.price - p.cost),
      ],
    }));
    const known = products.filter((x) => x.p.cost !== null);
    metrics = [
      { label: "Products sold", value: String(products.length) },
      {
        label: "Product retail",
        value: fmt(sum(products.map((x) => x.p.price))),
      },
      {
        label: "Known provider costs",
        value: fmt(sum(known.map((x) => x.p.cost!))),
      },
      {
        label: "Gross · cost recorded",
        value: fmt(sum(known.map((x) => x.p.price - x.p.cost!))),
      },
    ];
    note =
      "Product details use the quote saved at sale. Legacy service contract totals without itemized products remain in sold-deal recaps. Finance reserve is included in the sold profit report, not product gross.";
  } else if (report === "trades") {
    headers = [
      "Sold",
      "Customer",
      "Trade stock / vehicle",
      "Allowance",
      "ACV",
      "Under allowance",
      "Over allowance",
      "Payoff",
      "Disposition",
    ];
    const deals = sales.filter((s) => !!s.snapshot.opportunity.trade);
    rows = deals.map((s) => {
      const m = saleMath(s),
        t = ws.trades?.find((t) => t.sale_id === s.id);
      return {
        id: s.id,
        sale: s,
        cells: [
          s.sold_on,
          s.snapshot.customer.name,
          (t?.stock_number || "—") +
            " · " +
            (s.snapshot.opportunity.trade_vehicle || t?.vin || ""),
          fmt(m.allowance),
          fmt(m.acv),
          fmt(Math.max(0, m.adjustment)),
          fmt(Math.max(0, -m.adjustment)),
          fmt(
            s.snapshot.quote?.values.payoff ??
              s.snapshot.opportunity.trade?.payoff,
          ),
          t?.status ?? "Not in intake",
        ],
      };
    });
    metrics = [
      { label: "Trades acquired", value: String(deals.length) },
      {
        label: "Total allowance",
        value: fmt(sum(deals.map((s) => saleMath(s).allowance))),
      },
      {
        label: "Total ACV",
        value: fmt(sum(deals.map((s) => saleMath(s).acv))),
      },
      {
        label: "Under / (over) net",
        value: fmt(sum(deals.map((s) => saleMath(s).adjustment))),
      },
    ];
    note =
      "Sale-date trade values are preserved. Intake cost/recon can be updated separately without rewriting the original allowance or ACV.";
  } else if (report === "commissions") {
    headers = [
      "Team member",
      "Sold date",
      "Customer / vehicle",
      "Category",
      "Deal status",
      "Earned",
      "Paid to date",
      "Balance / recovery",
      "Last paid date",
    ];
    const commissions = (ws.commissions ?? []).filter(
      (c) =>
        (!staff || c.staff_id === staff) &&
        allSales.some((s) => s.id === c.sale_id),
    );
    rows = commissions.map((c) => {
      const s = allSales.find((s) => s.id === c.sale_id)!,
        cust = ws.customers.find((x) => x.id === s.customer_id),
        op = ws.opportunities.find((x) => x.id === s.opportunity_id),
        earned = s.status === "sold" ? c.amount : 0;
      return {
        id: c.id,
        sale: manager ? s : undefined,
        cells: [
          c.staff_name,
          s.sold_on,
          (s.snapshot?.customer?.name ?? cust?.name ?? "Customer") +
            " · " +
            (s.snapshot?.quote?.vehicle ?? op?.vehicle_interest ?? ""),
          c.category.toUpperCase(),
          s.status,
          fmt(earned),
          fmt(c.paid_amount),
          fmt(earned - c.paid_amount),
          c.paid_on || "—",
        ],
      };
    });
    const earned = sum(
        commissions.map((c) =>
          allSales.find((s) => s.id === c.sale_id)?.status === "sold"
            ? c.amount
            : 0,
        ),
      ),
      paid = sum(commissions.map((c) => c.paid_amount));
    metrics = [
      { label: "Commission entries", value: String(commissions.length) },
      { label: "Earned", value: fmt(earned) },
      { label: "Paid to date", value: fmt(paid) },
      { label: "Balance / (recovery)", value: fmt(earned - paid) },
    ];
    note =
      "Period is based on the deal’s sold date, including both endpoints. Paid to date is cumulative for those deals, not payments made during the selected period. Unwound deals earn zero; money already paid remains as a recovery balance. No pay plan is assumed—amounts are entered in each deal recap.";
  } else if (report === "wholesale") {
    headers = [
      "Wholesale date",
      "Stock",
      "Vehicle",
      "Cost",
      "Recon",
      "Proceeds",
      "Wholesale gross",
    ];
    const trades = (ws.trades ?? []).filter(
      (t) => t.status === "wholesaled" && withinDates(t.wholesale_on, from, to),
    );
    rows = trades.map((t) => ({
      id: t.id,
      cells: [
        t.wholesale_on,
        t.stock_number,
        vehicleName(t),
        fmt(t.cost),
        fmt(t.recon),
        fmt(t.wholesale_price),
        fmt((t.wholesale_price ?? 0) - t.cost - t.recon),
      ],
    }));
    metrics = [
      { label: "Wholesale units", value: String(trades.length) },
      {
        label: "Total proceeds",
        value: fmt(sum(trades.map((t) => t.wholesale_price ?? 0))),
      },
      {
        label: "Total invested",
        value: fmt(sum(trades.map((t) => t.cost + t.recon))),
      },
      {
        label: "Wholesale gross",
        value: fmt(
          sum(trades.map((t) => (t.wholesale_price ?? 0) - t.cost - t.recon)),
        ),
      },
    ];
    note =
      "Filtered by wholesale sale date. Wholesale income is reported separately from retail deal profit.";
  } else {
    headers = [
      "Original sale date",
      "Unwound at",
      "Customer",
      "Vehicle",
      "Reason",
    ];
    rows = allSales
      .filter((s) => s.status === "unwound")
      .map((s) => ({
        id: s.id,
        sale: s,
        cells: [
          s.sold_on,
          s.unwound_at
            ? new Date(s.unwound_at).toLocaleString("en-US", {
                timeZone: "America/New_York",
              })
            : "",
          s.snapshot.customer.name,
          s.snapshot.opportunity.vehicle_interest,
          s.unwind_reason,
        ],
      }));
    metrics = [{ label: "Unwound sales", value: String(rows.length) }];
    note =
      "Filtered by original sold date. Original deal snapshots are retained; reopened opportunities can be sold again as a new sale record.";
  }
  const invalid = report !== "inventory" && !!from && !!to && from > to,
    shown = invalid ? [] : rows;
  const title =
    names[report] +
    (staff ? " · " + (ws.staff.find((s) => s.id === staff)?.name || "") : "");
  const table = (print = false) => (
    <table className={print ? "ops-report-print-table" : ""}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h}>{h}</th>
          ))}
          {!print && manager && report !== "inventory" && <th />}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.id}>
            {r.cells.map((c, i) => (
              <td key={i}>{c ?? "—"}</td>
            ))}
            {!print && manager && report !== "inventory" && (
              <td>
                {r.sale && (
                  <button
                    className="text-btn"
                    onClick={() => setRecap(r.sale!.id)}
                  >
                    Recap
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
        {!shown.length && (
          <tr>
            <td colSpan={headers.length + 1}>No records match this report.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
  return (
    <>
      <section className="panel ops-accounting">
        <div className="section-heading">
          <div>
            <h2>
              <BarChart3 size={18} />
              Accounting & reports
            </h2>
            <p>Inventory investment, deal profitability, and team earnings.</p>
          </div>
          <div className="ops-actions">
            <button
              className="btn small"
              disabled={invalid}
              onClick={() => {
                const blob = new Blob(
                    [csvText([headers, ...shown.map((r) => r.cells)])],
                    { type: "text/csv;charset=utf-8" },
                  ),
                  url = URL.createObjectURL(blob),
                  a = document.createElement("a");
                a.href = url;
                a.download = `drive-max-${report}-${today}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={15} />
              CSV
            </button>
            <button
              className="btn small"
              disabled={invalid}
              onClick={() => setPrinting(true)}
            >
              <Printer size={15} />
              Print report
            </button>
          </div>
        </div>
        <div className="ops-report-tabs">
          {(Object.keys(names) as Report[])
            .filter((r) => manager || r === "commissions")
            .map((r) => (
              <button
                key={r}
                className={r === report ? "chosen" : ""}
                onClick={() => setReport(r)}
              >
                {names[r]}
              </button>
            ))}
        </div>
        <div className="ops-filter-grid">
          {report === "inventory" ? (
            <label>
              Inventory age
              <select
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
              >
                <option value={0}>All current units</option>
                {[30, 60, 90, 120, 180].map((n) => (
                  <option value={n} key={n}>
                    {n}+ days old
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                From
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
            </>
          )}
          {!["inventory", "wholesale", "unwound"].includes(report) && (
            <label>
              {report === "commissions"
                ? "Commission recipient"
                : "Salesperson"}
              <select value={staff} onChange={(e) => setStaff(e.target.value)}>
                <option value="">
                  {manager ? "All team members" : "My commissions"}
                </option>
                {ws.staff
                  .filter((s) => manager || s.id === ws.member.staff_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {report !== "inventory" && (
            <div className="ops-period-buttons">
              {["today", "month", "year", "all"].map((k) => (
                <button key={k} className="btn small" onClick={() => period(k)}>
                  {k === "all"
                    ? "All dates"
                    : k === "today"
                      ? "Today"
                      : "This " + k}
                </button>
              ))}
            </div>
          )}
        </div>
        {invalid && (
          <p className="form-error" role="alert">
            End date must be on or after start date.
          </p>
        )}
        <div className="ops-metrics">
          {metrics.map((m) => (
            <div key={m.label}>
              <small>{m.label}</small>
              <strong>{invalid ? "—" : m.value}</strong>
            </div>
          ))}
        </div>
        <p className="ops-help">{note}</p>
        <div className="table-scroll">{table()}</div>
      </section>
      {recap && (
        <DealRecap
          ws={ws}
          saleId={recap}
          run={run}
          busy={busy}
          onClose={() => setRecap(null)}
        />
      )}
      {printing && (
        <PrintDocument landscape onClose={() => setPrinting(false)}>
          <header className="ops-report-heading">
            <span>DRIVE MAX USED CARS</span>
            <h1>{title}</h1>
            <p>
              {report === "inventory"
                ? `As of ${today} · age ${age}+ days`
                : `${from || "Beginning"} through ${to || "Today"} · inclusive`}
            </p>
          </header>
          <div className="ops-metrics">
            {metrics.map((m) => (
              <div key={m.label}>
                <small>{m.label}</small>
                <strong>{m.value}</strong>
              </div>
            ))}
          </div>
          {table(true)}
          <p className="ops-help">{note}</p>
        </PrintDocument>
      )}
    </>
  );
}
