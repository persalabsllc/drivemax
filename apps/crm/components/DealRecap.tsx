"use client";
import { useState } from "react";
import { Printer, Plus, Trash2 } from "lucide-react";
import { type Workspace, fullMoney, canManage, quoteMath } from "../lib/model";
import {
  type Sale,
  type Commission,
  type DealAccounting,
  emptyAccounting,
  saleMath,
  productCostFor,
  productKinds,
  accountingSchema,
  commissionSchema,
  sum,
} from "../lib/operations";
import { type RunCommand } from "./Communications";
import { Modal } from "./ui";
import { PrintDocument } from "./PrintDocument";
const fmt = (n: number | null | undefined) =>
  n == null ? "Not recorded" : fullMoney(n);
function Lines({ rows }: { rows: [string, number | null | undefined][] }) {
  return (
    <dl className="ops-recap-lines">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{fmt(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function RecapDocument({ ws, sale }: { ws: Workspace; sale: Sale }) {
  const s = sale,
    q = s.snapshot.quote,
    v = q?.values,
    a = { ...emptyAccounting, ...s.accounting },
    m = saleMath(s, ws.commissions),
    vehicle = q?.vehicle_details ?? s.snapshot.opportunity.vehicle_details,
    commissions = (ws.commissions ?? []).filter((c) => c.sale_id === s.id),
    totals = v ? quoteMath(v) : null;
  return (
    <div className="ops-recap">
      <header className="ops-recap-header">
        <div>
          <span>DRIVE MAX USED CARS</span>
          <h1>Deal recap</h1>
          <p>
            Internal accounting · {s.status === "unwound" ? "UNWOUND" : "SOLD"}
          </p>
        </div>
        <div>
          Deal {s.id.slice(0, 8).toUpperCase()}
          <br />
          Sold {s.sold_on}
          <br />
          Stock {vehicle?.stock_number || "Not recorded"}
        </div>
      </header>
      <div className="ops-recap-identity">
        <strong>{s.snapshot.customer.name}</strong>
        <span>{q?.vehicle || s.snapshot.opportunity.vehicle_interest}</span>
        <span>VIN: {vehicle?.vin || "Not recorded"}</span>
        <span>
          Salesperson:{" "}
          {s.snapshot.salesperson?.name ||
            ws.staff.find((x) => x.id === s.snapshot.opportunity.assigned_to)
              ?.name ||
            "Unassigned"}
        </span>
        <span>Lender: {a.lender || "Not recorded"}</span>
        <span>
          Sell APR: {v?.apr ?? "—"}% · Buy APR: {a.buy_rate ?? "—"}%
        </span>
      </div>
      {s.status === "unwound" && (
        <p className="ops-unwind-banner">
          Unwound {s.unwound_at?.slice(0, 10)}: {s.unwind_reason}. Historical
          figures below are excluded from active sold gross. Paid commissions
          remain visible for recovery.
        </p>
      )}
      {!m.complete && (
        <p className="ops-incomplete">
          Incomplete accounting: enter a saved proposal and all vehicle/product
          costs before using profit totals.
        </p>
      )}
      <div className="ops-recap-columns">
        <section>
          <h2>Vehicle & front gross</h2>
          <Lines
            rows={[
              ["Sale price", v?.price],
              ["Vehicle cost", m.cost],
              ["Reconditioning", m.recon],
              ["Accessories / add-ons", v?.addOns ?? 0],
              ["Accessory cost", a.accessory_cost],
              ["Doc fee", v?.docFee],
              ["Trade under/(over) allowance", m.adjustment],
              ["Other direct costs", a.other_cost],
              ["Front gross", m.front],
              ["Pack (commission basis only)", a.pack],
              ["Commissionable front", m.payableFront],
            ]}
          />
        </section>
        <section>
          <h2>F&I & reserve</h2>
          <Lines
            rows={[
              ["Product retail", m.productRevenue],
              ["Product provider cost", m.productCost],
              ["Product gross", m.productGross],
              ["Finance reserve", a.finance_reserve],
              ["F&I gross", m.back],
            ]}
          />
          <h2>Trade figures</h2>
          <Lines
            rows={[
              ["Trade allowance", m.allowance],
              ["Trade ACV", m.acv],
              ["Under allowance", Math.max(0, m.adjustment)],
              ["Over allowance", Math.max(0, -m.adjustment)],
              [
                "Payoff",
                s.snapshot.opportunity.trade
                  ? (v?.payoff ?? s.snapshot.opportunity.trade.payoff)
                  : 0,
              ],
            ]}
          />
        </section>
        <section>
          <h2>Deal totals</h2>
          <Lines
            rows={[
              ["Total gross", m.gross],
              ["Commissions earned", m.earned],
              ["Commissions paid to date", m.paid],
              ["Commission balance", m.commissionBalance],
              [
                "Net after earned commissions",
                s.status === "sold" ? m.net : null,
              ],
            ]}
          />
          <h2>Customer settlement</h2>
          <Lines
            rows={[
              [
                "Tax / other taxes",
                v ? (totals?.tax ?? 0) + (v.otherTaxes ?? 0) : null,
              ],
              ["Title / registration", v?.titleFee],
              ["Total deal", totals?.total],
              ["Down payment", v?.downPayment],
              ["Amount financed / balance", totals?.balance],
            ]}
          />
        </section>
      </div>
      <h2>Products</h2>
      <table className="ops-recap-table">
        <thead>
          <tr>
            <th>Product / provider</th>
            <th>Term / miles</th>
            <th>Deductible</th>
            <th>Cost</th>
            <th>Retail</th>
            <th>Gross</th>
          </tr>
        </thead>
        <tbody>
          {v?.products?.map((p) => (
            <tr key={p.id}>
              <td>
                {productKinds[p.kind]}
                <small>
                  {p.provider} {p.contract_number}
                </small>
              </td>
              <td>
                {p.term_months || "—"} mo /{" "}
                {p.mileage_limit ? p.mileage_limit.toLocaleString() : "—"}
              </td>
              <td>{fmt(p.deductible)}</td>
              <td>{fmt(productCostFor(s, p))}</td>
              <td>{fmt(p.price)}</td>
              <td>
                {fmt(
                  productCostFor(s, p) === null
                    ? null
                    : p.price - productCostFor(s, p)!,
                )}
              </td>
            </tr>
          ))}
          {!v?.products?.length && (
            <tr>
              <td colSpan={6}>
                {m.productRevenue
                  ? "Legacy service contract amount — see aggregate cost above."
                  : "No F&I products recorded."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <h2>Commission detail</h2>
      <table className="ops-recap-table">
        <thead>
          <tr>
            <th>Team member</th>
            <th>Type</th>
            <th>Earned</th>
            <th>Paid to date</th>
            <th>Last paid date</th>
          </tr>
        </thead>
        <tbody>
          {commissions.map((c) => (
            <tr key={c.id}>
              <td>{c.staff_name}</td>
              <td>{c.category.toUpperCase()}</td>
              <td>{fmt(s.status === "sold" ? c.amount : 0)}</td>
              <td>{fmt(c.paid_amount)}</td>
              <td>{c.paid_on || "—"}</td>
            </tr>
          ))}
          {!commissions.length && (
            <tr>
              <td colSpan={5}>No commissions entered.</td>
            </tr>
          )}
        </tbody>
      </table>
      {a.notes && (
        <p className="ops-recap-notes">
          <strong>Accounting notes:</strong> {a.notes}
        </p>
      )}
      <footer>
        Gross excludes tax, title fees, trade payoff and down payment. Pack only
        reduces the commission basis. Net shown is deal contribution after
        entered commissions, before dealership overhead and income taxes.
      </footer>
    </div>
  );
}
export function DealRecap({
  ws,
  saleId,
  run,
  busy,
  onClose,
}: {
  ws: Workspace;
  saleId: string;
  run: RunCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false),
    [editing, setEditing] = useState(false);
  const sale = ws.sales?.find((s) => s.id === saleId);
  if (!sale || !canManage(ws.member.role)) return null;
  return (
    <>
      <Modal
        title="Deal recap & accounting"
        subtitle={sale.snapshot.customer.name}
        wide
        onClose={onClose}
      >
        <div className="ops-recap-controls">
          <button className="btn primary" onClick={() => setPrinting(true)}>
            <Printer size={15} />
            Print recap
          </button>
          <button
            className="btn"
            disabled={sale.status !== "sold"}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "View recap" : "Edit costs & commissions"}
          </button>
        </div>
        {editing ? (
          <AccountingEditor
            key={sale.id + sale.revision}
            ws={ws}
            sale={sale}
            run={run}
            busy={busy}
            onDone={() => setEditing(false)}
          />
        ) : (
          <RecapDocument ws={ws} sale={sale} />
        )}
      </Modal>
      {printing && (
        <PrintDocument onClose={() => setPrinting(false)}>
          <RecapDocument ws={ws} sale={sale} />
        </PrintDocument>
      )}
    </>
  );
}
function AccountingEditor({
  ws,
  sale,
  run,
  busy,
  onDone,
}: {
  ws: Workspace;
  sale: Sale;
  run: RunCommand;
  busy: boolean;
  onDone: () => void;
}) {
  const v =
    sale.snapshot.quote?.vehicle_details ??
    sale.snapshot.opportunity.vehicle_details;
  const [a, setA] = useState<DealAccounting>({
    ...emptyAccounting,
    ...sale.accounting,
    vehicle_cost: sale.accounting.vehicle_cost ?? v?.cost ?? null,
    recon: sale.accounting.recon ?? v?.recon ?? null,
  });
  const [entries, setEntries] = useState(
      (ws.commissions ?? [])
        .filter((c) => c.sale_id === sale.id)
        .map((c) => ({ ...c, paid_on: c.paid_on ?? "" })),
    ),
    [error, setError] = useState("");
  const moneyField = (
    k: keyof DealAccounting,
    label: string,
    nullable = false,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        required={!nullable}
        value={String(a[k] ?? "")}
        placeholder={nullable ? "Not recorded" : ""}
        onChange={(e) =>
          setA({
            ...a,
            [k]:
              e.target.value === "" && nullable ? null : Number(e.target.value),
          })
        }
      />
    </label>
  );
  const edit = (id: string, p: Partial<Commission>) =>
    setEntries(entries.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <form
      className="modal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const accounting = accountingSchema.parse(a),
            commissions = entries.map((c) => commissionSchema.parse(c));
          if (
            (
              await run(
                {
                  type: "save_accounting",
                  sale_id: sale.id,
                  revision: sale.revision,
                  accounting,
                  commissions,
                },
                "Accounting and commissions saved",
              )
            ).ok
          )
            onDone();
          else
            setError(
              "Could not save. Previously paid commissions must be retained; refresh if another user changed this deal.",
            );
        } catch {
          setError(
            "Review amounts and commission payment dates. Paid amounts cannot exceed earned amounts.",
          );
        }
      }}
    >
      <h3>Actual deal costs & income</h3>
      <div className="ops-form-grid">
        {moneyField("vehicle_cost", "Vehicle cost", true)}
        {moneyField("recon", "Reconditioning", true)}
        {moneyField("accessory_cost", "Accessory / add-on cost")}
        {moneyField("other_cost", "Other direct costs")}
        {moneyField("finance_reserve", "Finance reserve income")}
        {moneyField("pack", "Pack — commission basis only")}
        {!sale.snapshot.quote?.values.products &&
          moneyField(
            "legacy_product_cost",
            "Legacy service contract cost",
            true,
          )}
        <label>
          Lender
          <input
            value={a.lender}
            maxLength={250}
            onChange={(e) => setA({ ...a, lender: e.target.value })}
          />
        </label>
        <label>
          Buy rate APR
          <input
            type="number"
            min="0"
            max="50"
            step="0.001"
            value={a.buy_rate ?? ""}
            onChange={(e) =>
              setA({
                ...a,
                buy_rate: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      {sale.snapshot.quote?.values.products?.length ? (
        <>
          <h3>Actual F&I provider costs</h3>
          <p className="ops-help">
            Cost adjustments update accounting without changing the original
            customer proposal.
          </p>
          <div className="ops-form-grid">
            {sale.snapshot.quote.values.products.map((p) => (
              <label key={p.id}>
                {productKinds[p.kind]} · {p.provider || "Provider not set"}
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={a.product_costs?.[p.id] ?? p.cost ?? ""}
                  placeholder="Not recorded"
                  onChange={(e) =>
                    setA({
                      ...a,
                      product_costs: {
                        ...a.product_costs,
                        [p.id]:
                          e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
      <h3>Commissions</h3>
      <p className="ops-help">
        Enter the agreed earnings for each person. Paid to date is cumulative;
        its date is the latest payment date. Existing paid entries cannot be
        removed or reduced.
      </p>
      {entries.map((c) => (
        <div className="ops-commission-entry" key={c.id}>
          <div className="ops-form-grid">
            <label>
              Team member
              <select
                value={c.staff_id}
                onChange={(e) =>
                  edit(c.id, {
                    staff_id: e.target.value,
                    staff_name: ws.staff.find((s) => s.id === e.target.value)!
                      .name,
                  })
                }
              >
                {ws.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={c.category}
                onChange={(e) =>
                  edit(c.id, {
                    category: e.target.value as Commission["category"],
                  })
                }
              >
                <option value="sales">Sales</option>
                <option value="fi">F&I</option>
                <option value="bonus">Bonus</option>
              </select>
            </label>
            <label>
              Earned
              <input
                type="number"
                required
                min="0"
                max="1000000"
                step="0.01"
                value={c.amount}
                onChange={(e) => edit(c.id, { amount: Number(e.target.value) })}
              />
            </label>
            <label>
              Paid to date
              <input
                type="number"
                required
                min="0"
                max={c.amount}
                step="0.01"
                value={c.paid_amount}
                onChange={(e) =>
                  edit(c.id, { paid_amount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Last paid date
              <input
                type="date"
                required={c.paid_amount > 0}
                value={c.paid_on ?? ""}
                onChange={(e) => edit(c.id, { paid_on: e.target.value })}
              />
            </label>
            <label>
              Notes
              <input
                maxLength={1000}
                value={c.notes}
                onChange={(e) => edit(c.id, { notes: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            className="text-btn"
            disabled={
              (ws.commissions?.find((x) => x.id === c.id)?.paid_amount ?? 0) > 0
            }
            onClick={() => setEntries(entries.filter((x) => x.id !== c.id))}
          >
            <Trash2 size={13} />
            Remove unpaid entry
          </button>
        </div>
      ))}
      <button
        className="btn"
        type="button"
        onClick={() => {
          const staff =
            ws.staff.find((s) => s.id === sale.snapshot.salesperson?.id) ??
            ws.staff[0];
          if (staff)
            setEntries([
              ...entries,
              {
                id: crypto.randomUUID(),
                org_id: ws.org.id,
                sale_id: sale.id,
                staff_id: staff.id,
                staff_name: staff.name,
                category: "sales",
                amount: 0,
                paid_amount: 0,
                paid_on: "",
                notes: "",
              },
            ]);
        }}
      >
        <Plus size={15} />
        Add commission
      </button>
      <label>
        Accounting notes
        <textarea
          rows={3}
          maxLength={4000}
          value={a.notes}
          onChange={(e) => setA({ ...a, notes: e.target.value })}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        Save accounting
      </button>
    </form>
  );
}
