"use client";
import { useRef, useState } from "react";
import { Download, Plus } from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Command,
  type Workspace,
} from "../lib/model";
import {
  advertisingReport,
  adSpendSchema,
  type AdSpend,
} from "../lib/business";
import { downloadBusinessCsv } from "./MoneyOwed";
import { Modal, SectionTitle } from "./ui";
type Run = (p: Command, message?: string) => Promise<{ ok: boolean }>;
const cash = (n: number | null) => (n === null ? "—" : fullMoney(n));
export function Advertising({
  ws,
  run,
  busy,
  error,
}: {
  ws: Workspace;
  run: Run;
  busy: boolean;
  error: string;
}) {
  const [from, setFrom] = useState(dayKey().slice(0, 7) + "-01"),
    [to, setTo] = useState(dayKey()),
    [edit, setEdit] = useState<AdSpend | "new" | null>(null),
    [voiding, setVoiding] = useState<AdSpend | null>(null),
    [showVoided, setShowVoided] = useState(false),
    [history, setHistory] = useState<string | null>(null);
  const request = useRef({ text: "", id: "" });
  if (!canManage(ws.member.role)) return null;
  const report = advertisingReport(ws, from, to),
    spent =
      report.reduce((n, r) => n + Math.round((r.spend ?? 0) * 100), 0) / 100;
  const knownGross =
      report.reduce((n, r) => n + Math.round(r.completeGross * 100), 0) / 100,
    missing = report.reduce((n, r) => n + r.missingGross, 0);
  const entries = (ws.ad_spend ?? [])
    .filter(
      (e) =>
        e.spent_on >= from && e.spent_on <= to && (showVoided || !e.voided_at),
    )
    .sort(
      (a, b) =>
        b.spent_on.localeCompare(a.spent_on) ||
        b.created_at.localeCompare(a.created_at),
    );
  const sources = [
    ...new Set([
      "Facebook",
      "Website",
      "Walk-in",
      "Phone",
      "Referral",
      "Repeat customer",
      ...ws.opportunities.map((o) => o.source),
      ...(ws.ad_spend ?? []).map((e) => e.source),
    ]),
  ]
    .filter(Boolean)
    .sort();
  return (
    <section className="panel business-page">
      <SectionTitle
        title="Advertising profitability"
        subtitle="Compare recorded spend with the opportunities it brought in and their sales to date."
      />
      <div className="business-toolbar">
        <label>
          Leads created from
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            min={from}
            max={dayKey()}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="btn primary" onClick={() => setEdit("new")}>
          <Plus size={16} />
          Record ad spend
        </button>
        <button
          className="btn"
          onClick={() =>
            downloadBusinessCsv(`Drive-Max-Advertising-${from}-${to}.csv`, [
              [
                "Lead source",
                "Leads created",
                "Sales to date",
                "Recorded ad spend",
                "Cost per lead",
                "Cost per sale",
                "Cohort gross",
                "Deals missing gross",
                "Gross less recorded advertising",
                "Return on recorded spend %",
              ],
              ...report.map((r) => [
                r.name,
                r.leads,
                r.sold,
                r.spend,
                r.costPerLead,
                r.costPerSale,
                r.gross,
                r.missingGross,
                r.afterAdvertising,
                r.returnPercent,
              ]),
            ])
          }
        >
          <Download size={16} />
          Export report
        </button>
      </div>
      <div className="business-metrics">
        <article>
          <span>Recorded advertising</span>
          <strong>{fullMoney(spent)}</strong>
          <small>Active spend entries dated in this period</small>
        </article>
        <article>
          <span>Opportunities</span>
          <strong>{report.reduce((n, r) => n + r.leads, 0)}</strong>
          <small>Created in this period, grouped by source</small>
        </article>
        <article>
          <span>Sales from these leads</span>
          <strong>{report.reduce((n, r) => n + r.sold, 0)}</strong>
          <small>Completed sales to date; unwinds excluded</small>
        </article>
        <article className={missing ? "business-warning" : ""}>
          <span>{missing ? "Known deal gross" : "Deal gross"}</span>
          <strong>{fullMoney(knownGross)}</strong>
          <small>
            {missing
              ? `${missing} deal${missing === 1 ? "" : "s"} missing complete costs`
              : "From saved deal accounting"}
          </small>
        </article>
      </div>
      <p className="work-note">
        Spend uses the dates entered below; leads use their creation date in
        Eastern time. Sales and gross are outcomes of those leads to date, even
        if sold later. “Not entered” is different from $0. Return figures use
        recorded spend only and exclude overhead, commissions and other
        operating expenses. This is a source comparison, not proof that a
        specific ad caused a sale.
      </p>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Lead source</th>
              <th>Leads</th>
              <th>Sold to date</th>
              <th>Recorded spend</th>
              <th>Cost / lead</th>
              <th>Cost / sale</th>
              <th>Deal gross</th>
              <th>Gross after advertising</th>
              <th>Return on spend</th>
            </tr>
          </thead>
          <tbody>
            {report.map((r) => (
              <tr key={r.key}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td>{r.leads}</td>
                <td>{r.sold}</td>
                <td>{r.spend === null ? "Not entered" : cash(r.spend)}</td>
                <td>{cash(r.costPerLead)}</td>
                <td>{cash(r.costPerSale)}</td>
                <td>
                  {r.missingGross
                    ? `Incomplete · ${r.missingGross} deal${r.missingGross === 1 ? "" : "s"}`
                    : cash(r.gross)}
                </td>
                <td>{cash(r.afterAdvertising)}</td>
                <td>
                  {r.returnPercent === null
                    ? "—"
                    : `${r.returnPercent.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.length && (
          <p className="empty-business">
            No opportunities or advertising entries in this period.
          </p>
        )}
      </div>
      <div className="section-heading">
        <h3>Advertising spend entries</h3>
        <label className="check-line">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          Show voided entries
        </label>
      </div>
      <p className="fine-print">
        Use the same source label as the customer opportunity. You can record
        individual charges or a period total on its reporting date. Campaign
        names help organize expenses; they do not change lead attribution.
      </p>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Source / campaign</th>
              <th>Amount</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.spent_on}
                  {e.voided_at && <small>Voided</small>}
                </td>
                <td>
                  <strong>{e.source}</strong>
                  <small>{e.campaign}</small>
                </td>
                <td>{fullMoney(e.amount)}</td>
                <td>
                  {e.notes}
                  {e.voided_at && <small>{e.void_reason}</small>}
                </td>
                <td>
                  <div className="match-actions">
                    {!e.voided_at && (
                      <>
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() => setEdit(e)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() => setVoiding(e)}
                        >
                          Void
                        </button>
                      </>
                    )}
                    <button
                      className="text-btn"
                      onClick={() => setHistory(e.id)}
                    >
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && (
          <p className="empty-business">
            No spend recorded. Add a $0 entry when a source had no advertising
            cost and you want that reflected in the report.
          </p>
        )}
      </div>
      {edit && (
        <Modal
          title={
            edit === "new"
              ? "Record advertising spend"
              : "Edit advertising spend"
          }
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <SpendForm
            initial={edit === "new" ? null : edit}
            sources={sources}
            run={run}
            busy={busy}
            error={error}
            onDone={() => setEdit(null)}
          />
        </Modal>
      )}
      {voiding && (
        <Modal
          title="Void advertising entry"
          subtitle={`${voiding.source} · ${fullMoney(voiding.amount)} · ${voiding.spent_on}`}
          onClose={() => {
            if (!busy) setVoiding(null);
          }}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason"),
              );
              const p = {
                type: "void_ad_spend" as const,
                id: voiding.id,
                revision: voiding.revision,
                reason,
              };
              const text = JSON.stringify(p);
              if (request.current.text !== text)
                request.current = { text, id: crypto.randomUUID() };
              if (
                (
                  await run(
                    { ...p, request_id: request.current.id },
                    "Advertising entry voided",
                  )
                ).ok
              )
                setVoiding(null);
            }}
          >
            <p>
              The original entry stays in history and is removed from
              advertising totals.
            </p>
            <label>
              Reason
              <textarea name="reason" minLength={3} maxLength={2000} required />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              Void entry
            </button>
          </form>
        </Modal>
      )}
      {history && (
        <Modal
          title="Advertising entry history"
          onClose={() => setHistory(null)}
        >
          <div className="business-detail">
            {(ws.business_events ?? [])
              .filter((e) => e.subject_id === history)
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((e) => {
                const spend = e.payload.spend as AdSpend | undefined;
                return (
                  <article className="business-history" key={e.id}>
                    <strong>
                      {e.action === "void_ad_spend" ? "Voided" : "Saved"} ·{" "}
                      {new Date(e.created_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                      })}
                    </strong>
                    <p>
                      {spend
                        ? `${spend.source} · ${fullMoney(spend.amount)} · ${spend.spent_on}`
                        : String(e.payload.reason ?? "")}
                    </p>
                    <small>
                      {ws.staff.find((s) => s.user_id === e.created_by)?.name ??
                        "Team member"}
                    </small>
                  </article>
                );
              })}
          </div>
        </Modal>
      )}
    </section>
  );
}
function SpendForm({
  initial,
  sources,
  run,
  busy,
  error,
  onDone,
}: {
  initial: AdSpend | null;
  sources: string[];
  run: Run;
  busy: boolean;
  error: string;
  onDone: () => void;
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID()),
    [localError, setLocalError] = useState("");
  const request = useRef({ text: "", id: "" });
  return (
    <form
      className="modal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError("");
        const f = new FormData(e.currentTarget);
        const parsed = adSpendSchema.safeParse({
          spent_on: String(f.get("spent_on")),
          source: String(f.get("source")),
          amount: Number(f.get("amount")),
          campaign: String(f.get("campaign")),
          notes: String(f.get("notes")),
        });
        if (!parsed.success) {
          setLocalError(parsed.error.issues[0].message);
          return;
        }
        const p = {
          type: "save_ad_spend" as const,
          id,
          revision: initial?.revision ?? 0,
          spend: parsed.data,
        };
        const text = JSON.stringify(p);
        if (request.current.text !== text)
          request.current = { text, id: crypto.randomUUID() };
        if (
          (
            await run(
              { ...p, request_id: request.current.id },
              "Advertising spend saved",
            )
          ).ok
        )
          onDone();
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Spend date
          <input
            name="spent_on"
            type="date"
            defaultValue={initial?.spent_on ?? dayKey()}
            max={dayKey()}
            required
          />
        </label>
        <label>
          Lead source
          <input
            name="source"
            list="advertising-sources"
            maxLength={80}
            defaultValue={initial?.source ?? "Facebook"}
            required
          />
          <datalist id="advertising-sources">
            {sources.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          Amount spent
          <input
            name="amount"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={initial?.amount ?? ""}
            required
          />
        </label>
        <label>
          Campaign / invoice label
          <input
            name="campaign"
            maxLength={250}
            defaultValue={initial?.campaign ?? ""}
          />
        </label>
        <label>
          Notes
          <textarea
            name="notes"
            maxLength={2000}
            defaultValue={initial?.notes ?? ""}
          />
        </label>
        <button className="btn primary">Save advertising spend</button>
      </fieldset>
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
    </form>
  );
}
