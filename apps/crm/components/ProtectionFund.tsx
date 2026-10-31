"use client";
import { useRef, useState } from "react";
import { fullMoney, dayKey, type Workspace, type Command } from "../lib/model";
import {
  protectionFund,
  proposedPricing,
  type FundEntry,
} from "../lib/protection-pricing";
import { protectionPlans } from "../lib/protection";
import type { ManagementRun } from "./ServiceWorkspace";
import { Modal, SectionTitle } from "./ui";

export function ProtectionFund({
  ws,
  run,
  busy,
}: {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
}) {
  const fund = protectionFund(ws),
    entries = ws.protection_fund_entries ?? [],
    pricing = ws.product_pricing?.[0];
  const [editing, setEditing] = useState<"new" | FundEntry | null>(null),
    [search, setSearch] = useState("");
  const unissued = (ws.sales ?? [])
    .filter((s) => s.status === "sold")
    .flatMap((s) =>
      (s.snapshot.quote?.values.products ?? []).filter(
        (p) =>
          p.protection_plan &&
          !(ws.protection_contracts ?? []).some(
            (c) =>
              c.opportunity_id === s.opportunity_id && c.product_id === p.id,
          ),
      ),
    );
  return (
    <section className="panel pricing-settings">
      <SectionTitle
        title="Protection claims fund"
        subtitle={
          pricing?.active?.account_name ??
          pricing?.draft.account_name ??
          proposedPricing.account_name
        }
        action={
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => setEditing("new")}
          >
            Record fund transaction
          </button>
        }
      />
      <div className="pricing-totals">
        <span>
          Allocated balance to hold<strong>{fullMoney(fund.target)}</strong>
        </span>
        <span>
          Recorded cash balance<strong>{fullMoney(fund.balance)}</strong>
        </span>
        <span>
          Additional funding needed
          <strong>{fullMoney(fund.shortfall)}</strong>
        </span>
        <span>
          Contracts without a cost<strong>{fund.unknown}</strong>
        </span>
      </div>
      <p className="ops-help">
        Targets use saved contract allocations less paid claims, plus unpaid
        cancellation refunds. Expired coverage remains held for review of
        outstanding claims. Cash balances reflect recorded transactions only;
        reconcile them to the separate bank account. Record completed transfers
        here. Record claims and refunds on the contract and select “Paid from
        the protection claims fund” when applicable.
      </p>
      {(fund.unknown > 0 || unissued.length > 0) && (
        <p className="pricing-status">
          Funding total is incomplete: {fund.unknown} issued contracts have no
          saved cost; {unissued.length} sold protection products have not been
          contracted. Review these before funding the account.
        </p>
      )}
      <details>
        <summary>
          Contract allocations and deal contribution ({fund.rows.length})
        </summary>
        <label className="pricing-search">
          Find contract, VIN or customer
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Contract number, VIN or name"
          />
        </label>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Contract / customer</th>
                <th>Product / deal</th>
                <th>Sale price</th>
                <th>Internal allocation</th>
                <th>Contribution</th>
                <th>Claims paid</th>
                <th>Hold target</th>
              </tr>
            </thead>
            <tbody>
              {fund.rows
                .filter(({ contract: c }) =>
                  `${c.contract_number} ${c.vin} ${c.holder_name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map(({ contract: c, target }) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.contract_number}</strong>
                      <small>
                        {c.holder_name} · {c.status}
                      </small>
                      <small>{c.vin}</small>
                    </td>
                    <td>
                      {protectionPlans[c.plan]}
                      <small>
                        {c.opportunity_id
                          ? ws.opportunities.find(
                              (o) => o.id === c.opportunity_id,
                            )?.vehicle_interest || "Attached car deal"
                          : "Standalone contract"}
                      </small>
                    </td>
                    <td>{fullMoney(c.price)}</td>
                    <td>
                      {c.internal_cost == null
                        ? "Needs review"
                        : fullMoney(c.internal_cost)}
                    </td>
                    <td>
                      {c.internal_cost == null
                        ? "—"
                        : fullMoney(c.price - c.internal_cost)}
                    </td>
                    <td>{fullMoney(c.claims_paid)}</td>
                    <td>
                      {target === null ? "Needs review" : fullMoney(target)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>Fund transaction ledger ({entries.length})</summary>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Date / reference</th>
                <th>In</th>
                <th>Out</th>
                <th>Details</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              {[...entries]
                .sort(
                  (a, b) =>
                    b.posted_on.localeCompare(a.posted_on) ||
                    b.created_at.localeCompare(a.created_at),
                )
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.posted_on}
                      <small>{e.reference}</small>
                    </td>
                    <td>{e.direction === "in" ? fullMoney(e.amount) : "—"}</td>
                    <td>{e.direction === "out" ? fullMoney(e.amount) : "—"}</td>
                    <td>
                      {e.notes}
                      <small>
                        {
                          ws.protection_contracts?.find(
                            (c) => c.id === e.contract_id,
                          )?.contract_number
                        }
                      </small>
                    </td>
                    <td>
                      {e.reversal_of ? (
                        "Reversal"
                      ) : entries.some((r) => r.reversal_of === e.id) ? (
                        "Reversed"
                      ) : (
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() => setEditing(e)}
                        >
                          Reverse entry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!entries.length && (
          <p className="ops-help">No fund transactions recorded.</p>
        )}
      </details>
      {editing && (
        <FundForm
          ws={ws}
          entry={editing === "new" ? null : editing}
          run={run}
          busy={busy}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function FundForm({
  ws,
  entry,
  run,
  busy,
  onClose,
}: {
  ws: Workspace;
  entry: FundEntry | null;
  run: ManagementRun;
  busy: boolean;
  onClose: () => void;
}) {
  const [date, setDate] = useState(dayKey()),
    [amount, setAmount] = useState(""),
    [direction, setDirection] = useState<"in" | "out">("in"),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [contract, setContract] = useState(""),
    [error, setError] = useState("");
  const request = useRef({ payload: "", id: "" });
  return (
    <Modal
      title={
        entry ? "Reverse fund entry" : "Record a completed fund transaction"
      }
      subtitle="This records money already moved outside the CRM."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="modal-form protection-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const input = entry
            ? {
                type: "reverse_protection_fund",
                id: entry.id,
                posted_on: date,
                reason: notes,
              }
            : {
                type: "record_protection_fund",
                direction,
                amount: Number(amount),
                posted_on: date,
                reference,
                notes,
                contract_id: contract || null,
              };
          const payload = JSON.stringify(input);
          if (request.current.payload !== payload)
            request.current = { payload, id: crypto.randomUUID() };
          const result = await run(
            { ...input, request_id: request.current.id } as Command,
            entry ? "Fund correction recorded" : "Fund transaction recorded",
          );
          if (result.ok) onClose();
          else setError(result.error ?? "Unable to record transaction.");
        }}
      >
        <label>
          Transaction date
          <input
            type="date"
            required
            max={dayKey()}
            min={entry?.posted_on}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {entry ? (
          <p>
            Reverse {fullMoney(entry.amount)}{" "}
            {entry.direction === "in" ? "in" : "out"}: {entry.reference}. The
            original entry remains in the ledger. This correction does not
            reverse a claim, refund or bank transaction.
          </p>
        ) : (
          <>
            <label>
              Direction
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as "in" | "out")}
              >
                <option value="in">Money into claims fund</option>
                <option value="out">Money out of claims fund</option>
              </select>
            </label>
            <label>
              Amount
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
              Bank / transaction reference
              <input
                required
                maxLength={150}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label>
              Related contract (optional)
              <select
                value={contract}
                onChange={(e) => setContract(e.target.value)}
              >
                <option value="">General fund transaction</option>
                {ws.protection_contracts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contract_number} · {c.holder_name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          {entry ? "Correction reason" : "Notes"}
          <textarea
            required={!!entry}
            minLength={entry ? 3 : undefined}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {entry ? "Record reversal" : "Record transaction"}
        </button>
      </form>
    </Modal>
  );
}
