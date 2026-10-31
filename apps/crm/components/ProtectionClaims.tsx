"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Command,
  type Workspace,
} from "../lib/model";
import { protectionPlans } from "../lib/protection";
import {
  claimPayoutSummary,
  claimPeriodRange,
  type ClaimPeriod,
  type ProtectionClaim,
} from "../lib/protection-claims";
import type { ManagementRun } from "./ServiceWorkspace";
import { Empty, Modal, SectionTitle } from "./ui";

type Props = {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  contractId?: string;
  onOpenContract?: (id: string) => void;
};
type Mode = "new" | "view" | "edit" | "pay" | "close";
const periods: ClaimPeriod[] = ["month", "quarter", "year"];
const statusLabel = {
  open: "Open",
  paid: "Paid",
  closed: "Closed without payment",
};
const dateLabel = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function ProtectionClaims(props: Props) {
  const { ws, contractId, busy } = props;
  const [month, setMonth] = useState(() => dayKey().slice(0, 7)),
    [period, setPeriod] = useState<ClaimPeriod>("month"),
    [status, setStatus] = useState<ProtectionClaim["status"]>("open"),
    [search, setSearch] = useState(""),
    [dialog, setDialog] = useState<{ mode: Mode; id?: string } | null>(null);
  if (!canManage(ws.member.role)) return null;
  const claims = (ws.protection_claims ?? []).filter(
    (c) => !contractId || c.contract_id === contractId,
  );
  const open = claims.filter((c) => c.status === "open");
  const range = claimPeriodRange(month, period);
  const contracts = new Map(
    (ws.protection_contracts ?? []).map((c) => [c.id, c]),
  );
  const query = search.trim().toLowerCase();
  const rows = claims
    .filter((c) => {
      const contract = contracts.get(c.contract_id);
      const date = c.status === "paid" ? c.paid_on : c.closed_on;
      return (
        c.status === status &&
        (status === "open" ||
          (date && date >= range.start && date < range.end)) &&
        [
          c.claim_number,
          c.description,
          c.repairer,
          c.payment_reference,
          contract?.holder_name,
          contract?.contract_number,
          contract?.vin,
          contract ? protectionPlans[contract.plan] : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    })
    .sort(
      (a, b) =>
        (b.paid_on ?? b.closed_on ?? b.submitted_on).localeCompare(
          a.paid_on ?? a.closed_on ?? a.submitted_on,
        ) || b.created_at.localeCompare(a.created_at),
    );
  const canSubmit = [...contracts.values()].some(
    (c) => c.status === "active" && (!contractId || c.id === contractId),
  );
  const viewed = claims.find((c) => c.id === dialog?.id);
  return (
    <section className="protection-claims" aria-label="Protection claims">
      <SectionTitle
        title="Claims"
        subtitle={
          contractId
            ? "Claim history and payouts for this contract."
            : "Track open claims and payouts across your protection contracts."
        }
        action={
          <button
            className="btn primary"
            disabled={busy || !canSubmit}
            onClick={() => setDialog({ mode: "new" })}
          >
            <Plus size={16} />
            Submit claim
          </button>
        }
      />
      <div className="claims-report-controls">
        <label>
          Reporting month
          <input
            aria-label="Claims reporting month"
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                setMonth(e.target.value);
            }}
          />
        </label>
        <p>
          Payouts use the date paid. Open claims include every month. Totals
          cover {contractId ? "this contract" : "all contracts"}.
        </p>
      </div>
      <div className="claims-stats">
        <button
          className={status === "open" ? "selected" : ""}
          aria-pressed={status === "open"}
          onClick={() => setStatus("open")}
        >
          <span>Open claims · all dates</span>
          <strong>{open.length}</strong>
          <small>
            {fullMoney(
              open.reduce(
                (n, c) => n + Math.round((c.requested_amount ?? 0) * 100),
                0,
              ) / 100,
            )}{" "}
            estimated
            {open.some((c) => c.requested_amount === null)
              ? " · some estimates pending"
              : ""}
          </small>
        </button>
        {periods.map((p) => {
          const total = claimPayoutSummary(claims, month, p);
          return (
            <button
              key={p}
              aria-pressed={status === "paid" && period === p}
              className={status === "paid" && period === p ? "selected" : ""}
              onClick={() => {
                setStatus("paid");
                setPeriod(p);
              }}
            >
              <span>
                {p === "month"
                  ? "Monthly"
                  : p === "quarter"
                    ? "Quarterly"
                    : "Yearly"}{" "}
                payouts
              </span>
              <strong>{fullMoney(total.amount)}</strong>
              <small>
                {total.label} · {total.count} paid{" "}
                {total.count === 1 ? "claim" : "claims"}
              </small>
            </button>
          );
        })}
      </div>
      <div className="claims-list-controls">
        <div className="claims-tabs" role="group" aria-label="Claim status">
          {(["open", "paid", "closed"] as const).map((s) => (
            <button
              key={s}
              className={`btn small ${status === s ? "primary" : ""}`}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s === "closed" ? "Closed" : statusLabel[s]}
            </button>
          ))}
        </div>
        {status !== "open" && (
          <select
            aria-label="Claim reporting period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as ClaimPeriod)}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p === "month" ? "Month" : p === "quarter" ? "Quarter" : "Year"}{" "}
                · {claimPeriodRange(month, p).label}
              </option>
            ))}
          </select>
        )}
        <label className="claims-search">
          <Search size={16} />
          <input
            aria-label="Search claims"
            placeholder="Claim #, contract, customer or VIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <p className="ops-help">
        {rows.length} {status === "closed" ? "closed without payment" : status}{" "}
        {rows.length === 1 ? "claim" : "claims"}
        {status !== "open" ? ` · ${range.label}` : " · all dates"}
        {query ? " · matching your search" : ""}
      </p>
      {!rows.length ? (
        <Empty
          title={
            query
              ? "No matching claims"
              : status === "open"
                ? "No open claims"
                : `No ${status} claims in this period`
          }
          body={
            query
              ? "Try a claim number, contract number, customer or VIN."
              : status === "open"
                ? "Submit a claim against a contract to track it through payment."
                : "Choose another reporting month or period to see earlier claims."
          }
        />
      ) : (
        <div className="claims-list">
          {rows.map((c) => {
            const contract = contracts.get(c.contract_id);
            return (
              <article className="claims-row" key={c.id}>
                <button
                  className="claims-row-main"
                  onClick={() => setDialog({ mode: "view", id: c.id })}
                >
                  <span>
                    <strong>
                      {c.claim_number}
                      <span className={`claim-status ${c.status}`}>
                        {statusLabel[c.status]}
                      </span>
                    </strong>
                    <small>
                      {contract?.holder_name} ·{" "}
                      {contract
                        ? protectionPlans[contract.plan]
                        : "Protection contract"}
                    </small>
                    <span className="claim-description">{c.description}</span>
                    <small>
                      {c.status === "paid"
                        ? `Paid ${dateLabel(c.paid_on!)}`
                        : c.status === "closed"
                          ? `Closed ${dateLabel(c.closed_on!)}`
                          : `Submitted ${dateLabel(c.submitted_on)}`}
                      {c.repairer ? ` · ${c.repairer}` : ""}
                    </small>
                  </span>
                  <span className="claim-row-amount">
                    <strong>
                      {c.status === "paid"
                        ? fullMoney(c.amount!)
                        : c.requested_amount === null
                          ? "Pending"
                          : fullMoney(c.requested_amount)}
                    </strong>
                    <small>{c.status === "paid" ? "Paid" : "Estimate"}</small>
                  </span>
                </button>
                {props.onOpenContract ? (
                  <button
                    className="claim-contract-link text-btn"
                    onClick={() => props.onOpenContract!(c.contract_id)}
                  >
                    {contract?.contract_number} · {contract?.vin}
                    <ArrowUpRight size={14} />
                  </button>
                ) : (
                  <small className="claim-contract-link">
                    {contract?.contract_number} · {contract?.vin}
                  </small>
                )}
              </article>
            );
          })}
        </div>
      )}
      {dialog && (dialog.mode === "new" || viewed) && (
        <ClaimDialog
          key={`${dialog.id ?? "new"}-${dialog.mode}`}
          {...props}
          mode={dialog.mode}
          claim={viewed}
          onMode={(mode) => setDialog({ ...dialog, mode })}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function ClaimDialog({
  ws,
  run,
  busy,
  contractId,
  mode,
  claim,
  onMode,
  onClose,
}: Props & {
  mode: Mode;
  claim?: ProtectionClaim;
  onMode: (mode: Mode) => void;
  onClose: () => void;
}) {
  const [id] = useState(() => claim?.id ?? crypto.randomUUID());
  const [selected, setSelected] = useState(
    claim?.contract_id ?? contractId ?? "",
  );
  const contract = ws.protection_contracts?.find((c) => c.id === selected);
  const [revision] = useState(claim?.revision ?? 1),
    [contractRevision] = useState(contract?.revision ?? 1);
  const [submitted, setSubmitted] = useState(claim?.submitted_on ?? dayKey()),
    [service, setService] = useState(claim?.service_on ?? dayKey()),
    [mileage, setMileage] = useState(
      claim?.mileage == null ? "" : String(claim.mileage),
    ),
    [units, setUnits] = useState(claim?.units ?? 1),
    [description, setDescription] = useState(claim?.description ?? ""),
    [repairer, setRepairer] = useState(claim?.repairer ?? ""),
    [estimate, setEstimate] = useState(
      claim?.requested_amount == null ? "" : String(claim.requested_amount),
    ),
    [amount, setAmount] = useState(
      claim?.requested_amount == null ? "" : String(claim.requested_amount),
    ),
    [paidOn, setPaidOn] = useState(dayKey()),
    [reference, setReference] = useState(""),
    [fromFund, setFromFund] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const inFlight = useRef(false),
    key = useRef({ payload: "", id: "" });
  const editing = mode === "new" || mode === "edit";
  const title =
    mode === "new"
      ? "Submit protection claim"
      : mode === "edit"
        ? "Update claim details"
        : mode === "pay"
          ? "Record claim payment"
          : mode === "close"
            ? "Close claim without payment"
            : claim!.claim_number;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || busy) return;
    setError("");
    if (!contract) {
      setError("Choose a contract.");
      return;
    }
    const details = {
      submitted_on: submitted,
      service_on: service,
      mileage: Number(mileage),
      units: contract.plan === "key_replacement" ? units : 1,
      description,
      repairer,
      requested_amount: estimate === "" ? null : Number(estimate),
    };
    const payload =
      mode === "new"
        ? {
            type: "submit_protection_claim",
            id,
            contract_id: selected,
            details,
          }
        : mode === "edit"
          ? { type: "update_protection_claim", id, revision, details }
          : mode === "pay"
            ? {
                type: "pay_protection_claim",
                id,
                revision,
                contract_revision: contractRevision,
                amount: Number(amount),
                paid_on: paidOn,
                reference,
                paid_from_fund: fromFund,
              }
            : {
                type: "close_protection_claim",
                id,
                revision,
                closed_on: paidOn,
                reason,
              };
    const serialized = JSON.stringify(payload);
    if (key.current.payload !== serialized)
      key.current = { payload: serialized, id: crypto.randomUUID() };
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await run(
        { ...payload, request_id: key.current.id } as Command,
        mode === "new"
          ? "Claim submitted"
          : mode === "pay"
            ? "Claim payment recorded"
            : mode === "close"
              ? "Claim closed without payment"
              : "Claim updated",
      );
      if (result.ok) onClose();
      else setError(result.error ?? "Could not save this claim.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      title={title}
      subtitle={
        claim
          ? `${contract?.contract_number} · ${contract?.holder_name} · ${contract ? protectionPlans[contract.plan] : ""}`
          : "Choose the product contract this claim belongs to."
      }
      onClose={onClose}
      className="protection-modal"
      wide
    >
      {mode === "view" && claim ? (
        <div className="claims-dialog-body">
          <div className="claims-detail-heading">
            <span className={`claim-status ${claim.status}`}>
              {statusLabel[claim.status]}
            </span>
            <strong>
              {claim.status === "paid"
                ? fullMoney(claim.amount!)
                : claim.requested_amount === null
                  ? "Estimate pending"
                  : `${fullMoney(claim.requested_amount)} estimated`}
            </strong>
          </div>
          <p className="claims-description-full">{claim.description}</p>
          <dl className="protection-facts">
            <div>
              <dt>Submitted</dt>
              <dd>{dateLabel(claim.submitted_on)}</dd>
            </div>
            <div>
              <dt>Service date / mileage</dt>
              <dd>
                {claim.service_on
                  ? dateLabel(claim.service_on)
                  : "Not recorded"}{" "}
                · {claim.mileage?.toLocaleString() ?? "Not recorded"} miles
              </dd>
            </div>
            <div>
              <dt>Repair facility / payee</dt>
              <dd>{claim.repairer || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd>
                {contract?.year} {contract?.make} {contract?.model}
                <br />
                {contract?.vin}
              </dd>
            </div>
            {contract?.plan === "key_replacement" && (
              <div>
                <dt>Keys on this claim</dt>
                <dd>{claim.units}</dd>
              </div>
            )}
            {claim.status === "paid" && (
              <>
                <div>
                  <dt>Paid on / reference</dt>
                  <dd>
                    {dateLabel(claim.paid_on!)} · {claim.payment_reference}
                  </dd>
                </div>
                <div>
                  <dt>Claims fund entry</dt>
                  <dd>
                    {claim.paid_from_fund
                      ? "Recorded as a fund withdrawal"
                      : "No fund withdrawal recorded"}
                  </dd>
                </div>
              </>
            )}
            {claim.status === "closed" && (
              <div>
                <dt>Closed {dateLabel(claim.closed_on!)}</dt>
                <dd>{claim.closure_reason}</dd>
              </div>
            )}
          </dl>
          {claim.status === "open" && (
            <div className="ops-actions">
              <button
                className="btn primary"
                disabled={busy || contract?.status === "canceled"}
                onClick={() => onMode("pay")}
              >
                Record payment
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => onMode("edit")}
              >
                Edit details
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => onMode("close")}
              >
                Close without payment
              </button>
            </div>
          )}
          {claim.status === "open" && contract?.status === "canceled" && (
            <p className="ops-help">
              This contract is canceled. The claim can be reviewed and closed.
            </p>
          )}
          <h3>Claim history</h3>
          <div className="claims-history">
            {(ws.protection_claim_events ?? [])
              .filter((e) => e.claim_id === claim.id)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((e) => (
                <p key={e.id}>
                  <strong>
                    {(
                      {
                        submit_protection_claim: "Submitted",
                        update_protection_claim: "Details updated",
                        pay_protection_claim: "Payment recorded",
                        close_protection_claim: "Closed without payment",
                      } as Record<string, string>
                    )[String(e.command.type)] ?? "Updated"}
                  </strong>
                  <small>
                    {new Date(e.created_at).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                    })}
                  </small>
                </p>
              ))}
          </div>
          {!ws.protection_claim_events?.some(
            (e) => e.claim_id === claim.id,
          ) && (
            <p className="ops-help">
              Recorded from the contract’s existing paid-claim history.
              Submission date uses the payment date when no separate submission
              was recorded.
            </p>
          )}
        </div>
      ) : (
        <form className="protection-form claims-dialog-body" onSubmit={submit}>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <fieldset disabled={busy || saving}>
            {editing && (
              <>
                {mode === "new" && (
                  <label>
                    Product contract
                    <select
                      required
                      value={selected}
                      onChange={(e) => {
                        setSelected(e.target.value);
                        setUnits(1);
                      }}
                    >
                      <option value="">Choose a contract</option>
                      {(ws.protection_contracts ?? [])
                        .filter(
                          (c) =>
                            c.status === "active" &&
                            (!contractId || c.id === contractId),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.contract_number} · {c.holder_name} ·{" "}
                            {protectionPlans[c.plan]} · {c.vin}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <div className="claims-form-grid">
                  <label>
                    Submitted on
                    <input
                      type="date"
                      required
                      min={contract?.issued_on}
                      max={dayKey()}
                      value={submitted}
                      onChange={(e) => setSubmitted(e.target.value)}
                    />
                  </label>
                  <label>
                    Service / loss date
                    <input
                      type="date"
                      required
                      min={contract?.issued_on}
                      max={submitted}
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                    />
                  </label>
                  <label>
                    Odometer at service
                    <input
                      type="number"
                      required
                      min={contract?.start_miles ?? 0}
                      max={6000000}
                      step="1"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                    />
                  </label>
                  <label>
                    Estimated payout (optional)
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      placeholder="Pending estimate"
                      value={estimate}
                      onChange={(e) => setEstimate(e.target.value)}
                    />
                  </label>
                </div>
                {contract?.plan === "key_replacement" && (
                  <label>
                    Number of keys
                    <select
                      value={units}
                      onChange={(e) => setUnits(Number(e.target.value))}
                    >
                      <option value="1">1 key</option>
                      <option value="2">2 keys</option>
                    </select>
                  </label>
                )}
                <label>
                  Repair facility / payee (optional)
                  <input
                    maxLength={250}
                    value={repairer}
                    onChange={(e) => setRepairer(e.target.value)}
                  />
                </label>
                <label>
                  Claim details
                  <textarea
                    required
                    minLength={3}
                    maxLength={2000}
                    rows={4}
                    placeholder="Describe the repair, damage or service requested."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <p className="ops-help">
                  An open claim does not reduce the claims fund or the
                  contract’s remaining benefit. Coverage and benefit limits are
                  checked when payment is recorded.
                </p>
              </>
            )}
            {mode === "pay" && (
              <>
                <p>{claim?.description}</p>
                <div className="claims-form-grid">
                  <label>
                    Actual amount paid
                    <input
                      type="number"
                      required
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Paid on
                    <input
                      type="date"
                      required
                      min={claim?.submitted_on}
                      max={dayKey()}
                      value={paidOn}
                      onChange={(e) => setPaidOn(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Payment / invoice reference
                  <input
                    required
                    maxLength={250}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label className="claims-check">
                  <input
                    type="checkbox"
                    checked={fromFund}
                    onChange={(e) => setFromFund(e.target.checked)}
                  />
                  Record this payment as a claims fund withdrawal
                </label>
                <p className="ops-help">
                  Record a payment already made. This updates the contract’s
                  paid claims and payout reports; it does not send money.
                </p>
              </>
            )}
            {mode === "close" && (
              <>
                <label>
                  Closed on
                  <input
                    type="date"
                    required
                    min={claim?.submitted_on}
                    max={dayKey()}
                    value={paidOn}
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    minLength={3}
                    maxLength={1000}
                    rows={3}
                    placeholder="For example, withdrawn or not covered."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p className="ops-help">
                  The claim stays in its history with no payment or fund
                  withdrawal.
                </p>
              </>
            )}
          </fieldset>
          <footer className="ops-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy || saving || !contract}
            >
              {saving
                ? "Saving…"
                : mode === "new"
                  ? "Submit claim"
                  : mode === "edit"
                    ? "Save details"
                    : mode === "pay"
                      ? "Record payment"
                      : "Close without payment"}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
