"use client";
import { useRef, useState } from "react";
import { Download, Plus, WalletCards } from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Command,
  type Customer,
  type Workspace,
} from "../lib/model";
import { csvText } from "../lib/operations";
import {
  businessCommands,
  moneyPlanSchema,
  paymentMethods,
  receivableRows,
  suggestedMoneyPlan,
  type MoneyEntry,
} from "../lib/business";
import { fundingStages } from "../lib/sales-work";
import { Modal, SectionTitle } from "./ui";
type Run = (p: Command, message?: string) => Promise<{ ok: boolean }>;
type Row = ReturnType<typeof receivableRows>[number];
export function downloadBusinessCsv(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function MoneyOwed({
  ws,
  run,
  busy,
  error,
  onOpen,
}: {
  ws: Workspace;
  run: Run;
  busy: boolean;
  error: string;
  onOpen: (c: Customer, opportunityId: string) => void;
}) {
  const [filter, setFilter] = useState("active"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  if (!canManage(ws.member.role)) return null;
  const rows = receivableRows(ws, dayKey()),
    active = rows.filter((r) => r.sale.status === "sold"),
    reviewed = active.filter((r) => r.plan);
  const lender =
    reviewed.reduce(
      (n, r) => n + Math.round(Math.max(0, r.lenderBalance!) * 100),
      0,
    ) / 100;
  const customer =
    reviewed.reduce(
      (n, r) => n + Math.round(Math.max(0, r.customerBalance!) * 100),
      0,
    ) / 100;
  const unknown = active.filter((r) => !r.plan).length;
  const shown = rows
    .filter((r) =>
      filter === "unwound"
        ? r.sale.status === "unwound"
        : r.sale.status === "sold" &&
          (filter === "active" ||
            (filter === "review" && !r.plan) ||
            (filter === "owed" && r.due !== null && r.due > 0) ||
            (filter === "settled" && r.due === 0)),
    )
    .filter((r) =>
      [
        r.sale.snapshot?.customer?.name,
        r.plan?.lender,
        r.sale.snapshot?.opportunity?.vehicle_interest,
        r.sale.snapshot?.quote?.vehicle_details?.stock_number,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const chosen = rows.find((r) => r.sale.id === selected);
  return (
    <section className="panel business-page">
      <SectionTitle
        title="Money owed to Drive Max"
        subtitle="Track expected funds and recorded receipts for sold deals."
      />
      <div className="business-metrics">
        <article>
          <span>Lender funding due</span>
          <strong>{fullMoney(lender)}</strong>
          <small>Confirmed expected funding less receipts</small>
        </article>
        <article>
          <span>Customer money due</span>
          <strong>{fullMoney(customer)}</strong>
          <small>Down payments and cash-sale balances</small>
        </article>
        <article>
          <span>Total confirmed due</span>
          <strong>{fullMoney(lender + customer)}</strong>
          <small>
            {unknown
              ? `${unknown} deal${unknown === 1 ? "" : "s"} still need amount review`
              : `${reviewed.length} reviewed sold deals`}
          </small>
        </article>
        <article className={unknown ? "business-warning" : ""}>
          <span>Amounts to review</span>
          <strong>{unknown}</strong>
          <small>Unreviewed amounts are excluded from totals</small>
        </article>
      </div>
      <p className="work-note">
        Receipt totals record money actually received. Saved deal figures and a
        “Funded” status do not create receipts automatically. Unwound deals
        remain in history and are excluded from amounts due.
      </p>
      <div className="business-toolbar">
        <label>
          Find a deal
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, vehicle, lender or stock…"
          />
        </label>
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">All sold deals</option>
            <option value="owed">Money outstanding</option>
            <option value="review">Needs amount review</option>
            <option value="settled">Settled / overpaid</option>
            <option value="unwound">Unwound history</option>
          </select>
        </label>
        <button
          className="btn"
          onClick={() =>
            downloadBusinessCsv(`Drive-Max-Money-Owed-${dayKey()}.csv`, [
              [
                "Customer",
                "Sold on",
                "Days old",
                "Status",
                "Lender",
                "Expected lender",
                "Lender received",
                "Lender balance",
                "Expected customer",
                "Customer received",
                "Customer balance",
                "Confirmed due",
                "Overpayment",
              ],
              ...shown.map((r) => [
                r.sale.snapshot?.customer?.name,
                r.sale.sold_on,
                r.age,
                r.sale.status,
                r.plan?.lender,
                r.plan?.expected_lender,
                r.lenderReceived,
                r.lenderBalance,
                r.plan?.expected_customer,
                r.customerReceived,
                r.customerBalance,
                r.due,
                r.overpayment,
              ]),
            ])
          }
        >
          <Download size={16} />
          Export view
        </button>
      </div>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Customer / vehicle</th>
              <th>Sold / age</th>
              <th>Funding / next step</th>
              <th>Lender due</th>
              <th>Customer due</th>
              <th>Total due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sale.id}>
                <td>
                  <strong>
                    {r.sale.snapshot?.customer?.name ?? "Customer"}
                  </strong>
                  <small>
                    {r.sale.snapshot?.opportunity?.vehicle_interest}
                  </small>
                </td>
                <td>
                  {r.sale.sold_on}
                  <small>
                    {r.age} days{r.overdue ? " · Overdue" : ""}
                  </small>
                </td>
                <td>
                  {r.plan?.lender || r.stage?.lender || "—"}
                  <small>
                    {r.stage ? fundingStages[r.stage.funding] : "Not started"}
                    {r.stage?.stipulations ? ` · ${r.stage.stipulations}` : ""}
                  </small>
                </td>
                <td>
                  {r.plan
                    ? fullMoney(Math.max(0, r.lenderBalance!))
                    : "Needs review"}
                </td>
                <td>
                  {r.plan
                    ? fullMoney(Math.max(0, r.customerBalance!))
                    : "Needs review"}
                </td>
                <td>
                  {r.due === null ? "—" : fullMoney(r.due)}
                  {r.overpayment > 0 && (
                    <small>Overpayment {fullMoney(r.overpayment)}</small>
                  )}
                </td>
                <td>
                  <button
                    className="btn small"
                    onClick={() => setSelected(r.sale.id)}
                  >
                    {r.plan ? "View receipts" : "Review amounts"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="empty-business">No deals match this view.</p>
        )}
      </div>
      {chosen && (
        <Modal
          title="Deal funds & receipts"
          subtitle={`${chosen.sale.snapshot?.customer?.name} · Sold ${chosen.sale.sold_on}`}
          wide
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <MoneyDetail
            key={`${chosen.sale.id}:${chosen.plan?.revision ?? 0}`}
            row={chosen}
            ws={ws}
            run={run}
            busy={busy}
            error={error}
          />
          <div className="modal-footer">
            <span>Receipt entries do not charge or transfer money.</span>
            <button
              className="btn"
              onClick={() => {
                const c = ws.customers.find(
                  (c) => c.id === chosen.sale.customer_id,
                );
                if (c) {
                  setSelected(null);
                  onOpen(c, chosen.sale.opportunity_id);
                }
              }}
            >
              Open customer
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function MoneyDetail({
  row,
  ws,
  run,
  busy,
  error,
}: {
  row: Row;
  ws: Workspace;
  run: Run;
  busy: boolean;
  error: string;
}) {
  const base = row.plan ?? suggestedMoneyPlan(row.sale, ws);
  const [lender, setLender] = useState(base.expected_lender?.toString() ?? ""),
    [customer, setCustomer] = useState(
      base.expected_customer?.toString() ?? "",
    ),
    [checked, setChecked] = useState(!!row.plan),
    [localError, setLocalError] = useState(""),
    [receipt, setReceipt] = useState(false),
    [reversing, setReversing] = useState<MoneyEntry | null>(null);
  const [reversalId] = useState(() => crypto.randomUUID());
  const request = useRef<{ text: string; id: string }>({ text: "", id: "" });
  function withRequest(p: Record<string, unknown>) {
    const text = JSON.stringify(p);
    if (request.current.text !== text)
      request.current = { text, id: crypto.randomUUID() };
    return { ...p, request_id: request.current.id };
  }
  const closed = row.sale.status !== "sold";
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError("");
    const f = new FormData(e.currentTarget);
    const parsed = moneyPlanSchema.safeParse({
      expected_lender: lender === "" ? null : Number(lender),
      expected_customer: customer === "" ? null : Number(customer),
      lender: String(f.get("lender")),
      lender_due: f.get("lender_due") || null,
      customer_due: f.get("customer_due") || null,
      notes: String(f.get("notes")),
    });
    if (!parsed.success || !checked) {
      setLocalError(
        "Review both expected amounts, including zero where nothing is due.",
      );
      return;
    }
    await run(
      withRequest({
        type: "save_money_plan",
        sale_id: row.sale.id,
        revision: row.plan?.revision ?? 0,
        plan: parsed.data,
      }) as Command,
      "Expected funds saved",
    );
  }
  return (
    <div className="business-detail">
      {closed && (
        <p className="business-notice">
          This sale was unwound. Its amounts and receipts are retained as
          history.
        </p>
      )}
      {!row.plan && (
        <p className="business-notice">
          Review the suggestions against the signed deal and lender funding
          notice. Confirm lender discounts or other adjustments here; these
          figures do not change deal profit.
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={busy || closed}>
          <div className="form-grid">
            <label>
              Expected lender funds
              <input
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={lender}
                onChange={(e) => {
                  setLender(e.target.value);
                  setChecked(false);
                }}
                required
              />
            </label>
            <label>
              Expected customer funds
              <input
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={customer}
                onChange={(e) => {
                  setCustomer(e.target.value);
                  setChecked(false);
                }}
                required
              />
            </label>
            <label>
              Lender
              <input
                name="lender"
                maxLength={250}
                defaultValue={base.lender ?? ""}
              />
            </label>
            <label>
              Lender expected by
              <input
                name="lender_due"
                type="date"
                defaultValue={base.lender_due ?? ""}
              />
            </label>
            <label>
              Customer payment due
              <input
                name="customer_due"
                type="date"
                defaultValue={base.customer_due ?? ""}
              />
            </label>
            <label>
              Review notes
              <input
                name="notes"
                maxLength={2000}
                defaultValue={base.notes ?? ""}
              />
            </label>
          </div>
          <label className="check-line">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I reviewed the total funds expected from the lender and customer,
            including amounts already received.
          </label>
          {!closed && (
            <button className="btn primary">Save expected funds</button>
          )}
        </fieldset>
      </form>
      <div className="business-receipt-summary">
        <span>
          Lender received <strong>{fullMoney(row.lenderReceived)}</strong>
        </span>
        <span>
          Customer received <strong>{fullMoney(row.customerReceived)}</strong>
        </span>
        <span>
          Remaining due{" "}
          <strong>
            {row.due === null ? "Needs review" : fullMoney(row.due)}
          </strong>
        </span>
        {row.overpayment > 0 && (
          <span>
            Overpayment to review <strong>{fullMoney(row.overpayment)}</strong>
          </span>
        )}
      </div>
      <div className="section-heading">
        <h3>
          <WalletCards size={17} /> Receipt history
        </h3>
        {row.plan && !closed && (
          <button
            className="btn small"
            disabled={busy}
            onClick={() => setReceipt(true)}
          >
            <Plus size={16} />
            Record receipt
          </button>
        )}
      </div>
      {!row.entries.length ? (
        <p className="muted-copy">No receipts recorded.</p>
      ) : (
        <div className="table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>From / method</th>
                <th>Amount</th>
                <th>Reference / notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {row.entries
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.received_on}
                      <small>
                        {ws.staff.find((s) => s.user_id === e.created_by)
                          ?.name ?? "Team member"}
                      </small>
                    </td>
                    <td>
                      {e.kind === "lender" ? "Lender" : "Customer"}
                      <small>
                        {e.method}
                        {e.reversal_of ? " · Correction" : ""}
                      </small>
                    </td>
                    <td>{fullMoney(e.amount * (e.reversal_of ? -1 : 1))}</td>
                    <td>
                      {e.reference}
                      <small>{e.notes}</small>
                    </td>
                    <td>
                      {!closed &&
                        !e.reversal_of &&
                        !row.entries.some((r) => r.reversal_of === e.id) && (
                          <button
                            className="text-btn"
                            disabled={busy}
                            onClick={() => setReversing(e)}
                          >
                            Reverse entry
                          </button>
                        )}
                      {row.entries.some((r) => r.reversal_of === e.id) && (
                        <small>Reversed</small>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      {receipt && (
        <Modal
          title="Record money received"
          onClose={() => {
            if (!busy) setReceipt(false);
          }}
        >
          <ReceiptForm
            row={row}
            run={run}
            busy={busy}
            error={error}
            onDone={() => setReceipt(false)}
          />
        </Modal>
      )}
      {reversing && (
        <Modal
          title="Reverse a receipt entry"
          subtitle="Correct a recorded entry while keeping its original history."
          onClose={() => {
            if (!busy) setReversing(null);
          }}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const p = withRequest({
                type: "reverse_money",
                id: reversalId,
                sale_id: row.sale.id,
                revision: row.plan!.revision,
                original_id: reversing.id,
                received_on: dayKey(),
                reason: String(f.get("reason")),
              });
              if ((await run(p as Command, "Receipt correction recorded")).ok)
                setReversing(null);
            }}
          >
            <p>
              {fullMoney(reversing.amount)} · {reversing.received_on} ·{" "}
              {reversing.kind}
            </p>
            <label>
              Correction reason
              <textarea name="reason" minLength={3} maxLength={2000} required />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              Reverse recorded receipt
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function ReceiptForm({
  row,
  run,
  busy,
  error,
  onDone,
}: {
  row: Row;
  run: Run;
  busy: boolean;
  error: string;
  onDone: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID()),
    [kind, setKind] = useState<"lender" | "customer">(
      (row.lenderBalance ?? 0) > 0 ? "lender" : "customer",
    ),
    [localError, setLocalError] = useState("");
  const request = useRef({ text: "", id: "" });
  return (
    <form
      className="modal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError("");
        const f = new FormData(e.currentTarget);
        const payload = {
          type: "record_money" as const,
          id,
          sale_id: row.sale.id,
          revision: row.plan!.revision,
          kind,
          amount: Number(f.get("amount")),
          received_on: String(f.get("received_on")),
          method: String(f.get("method")),
          reference: String(f.get("reference")),
          notes: String(f.get("notes")),
        };
        const signature = JSON.stringify(payload);
        if (request.current.text !== signature)
          request.current = { text: signature, id: crypto.randomUUID() };
        const parsed = businessCommands[1].safeParse({
          ...payload,
          request_id: request.current.id,
        });
        if (!parsed.success) {
          setLocalError(parsed.error.issues[0].message);
          return;
        }
        if ((await run(parsed.data, "Receipt recorded")).ok) onDone();
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Received from
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="lender">Lender</option>
            <option value="customer">Customer</option>
          </select>
        </label>
        <label>
          Amount received
          <input
            name="amount"
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            required
          />
        </label>
        <label>
          Date received
          <input
            name="received_on"
            type="date"
            defaultValue={dayKey()}
            max={dayKey()}
            required
          />
        </label>
        <label>
          Payment method
          <select name="method">
            {paymentMethods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Reference / check number
          <input name="reference" maxLength={250} />
        </label>
        <label>
          Notes
          <textarea name="notes" maxLength={2000} />
        </label>
        <button className="btn primary">Save receipt</button>
      </fieldset>
      {(localError || error) && (
        <p role="alert" className="form-error">
          {localError || error}
        </p>
      )}
    </form>
  );
}
