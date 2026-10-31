"use client";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, ShieldCheck, FileText, Search } from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Workspace,
  type Quote,
  type Command,
} from "../lib/model";
import {
  protectionLabel,
  protectionPlans,
  protectionRefund,
  selectedProtectionProducts,
  type ProtectionContract,
} from "../lib/protection";
import { Modal, Empty, SectionTitle } from "./ui";
import type { ManagementRun } from "./ServiceWorkspace";
import { ProtectionPDFPreview } from "./ProtectionPDFPreview";
import { ProtectionClaims } from "./ProtectionClaims";
import { ProtectionIssue } from "./ProtectionIssue";
import { protectionDescriptions } from "../lib/protection-programs";
import {
  protectionProductMatches,
  protectionTermLabel,
  protectionUsage,
} from "../lib/protection";

type Context = {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  demo: boolean;
};
const stamp = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
const actions: Record<string, string> = {
  issue_protection: "Contract issued",
  issue_protection_batch: "Contract packet issued",
  cancel_protection: "Contract canceled",
  record_protection_claim: "Paid claim recorded",
  record_protection_refund: "Refund payment recorded",
};
function useRequestKey() {
  const ref = useRef({ payload: "", key: "" });
  return (value: unknown) => {
    const payload = JSON.stringify(value);
    if (payload !== ref.current.payload)
      ref.current = { payload, key: crypto.randomUUID() };
    return ref.current.key;
  };
}
export function ProtectionWorkspace(props: Context) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    [issuing, setIssuing] = useState(false),
    [printingIds, setPrintingIds] = useState<string[]>([]);
  const { ws } = props;
  const printingContracts = useMemo(
    () =>
      printingIds.flatMap((id) => {
        const contract = ws.protection_contracts?.find((c) => c.id === id);
        return contract ? [contract] : [];
      }),
    [printingIds, ws.protection_contracts],
  );
  if (!canManage(ws.member.role)) return null;
  const contracts = ws.protection_contracts ?? [],
    today = dayKey(),
    contract = contracts.find((c) => c.id === selected);
  const due = contracts.filter(
    (c) =>
      c.cancellation && !c.cancellation.paid_on && c.cancellation.refund > 0,
  );
  const rows = contracts
    .filter(
      (c) =>
        [c.contract_number, c.vin, c.holder_name, c.stock_number]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (filter === "all" ||
          (filter === "refund"
            ? due.includes(c)
            : protectionLabel(c, today).toLowerCase() === filter)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section className="management-page protection-workspace">
      {contract ? (
        <ProtectionDetail
          {...props}
          contract={contract}
          onBack={() => setSelected("")}
        />
      ) : (
        <>
          <SectionTitle
            title="Drive Max Protection"
            subtitle="Quote and issue protection products, find a contract, or calculate a cancellation."
            action={
              <button className="btn primary" onClick={() => setIssuing(true)}>
                <Plus size={16} />
                Quote / issue products
              </button>
            }
          />
          <div className="protection-stats">
            <button onClick={() => setFilter("all")}>
              <span>Contracts issued</span>
              <strong>{contracts.length}</strong>
            </button>
            <button onClick={() => setFilter("active")}>
              <span>Within date term</span>
              <strong>
                {
                  contracts.filter(
                    (c) => protectionLabel(c, today) === "Active",
                  ).length
                }
              </strong>
            </button>
            <button onClick={() => setFilter("refund")}>
              <span>Refunds to pay</span>
              <strong>
                {fullMoney(
                  due.reduce((sum, c) => sum + c.cancellation!.refund, 0),
                )}
              </strong>
            </button>
          </div>
          <div className="protection-search">
            <label>
              <Search size={16} />
              <input
                aria-label="Find contract by VIN or contract number"
                placeholder="VIN, contract number, customer or stock #"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Contract status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All contracts</option>
              <option value="active">Within date term</option>
              <option value="term ended">Term ended</option>
              <option value="canceled">Canceled</option>
              <option value="refund">Refund due</option>
            </select>
          </div>
          {!rows.length ? (
            <Empty
              title={
                contracts.length
                  ? "No matching contracts"
                  : "Your protection book starts here"
              }
              body={
                contracts.length
                  ? "Try a VIN or contract number, or change the status filter."
                  : "Issue Drive Max products here, or contract all selected F&I menu products together in Desking."
              }
            />
          ) : (
            <div className="protection-list">
              {rows.map((c) => (
                <button
                  className="protection-list-row"
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="protection-symbol">
                    <ShieldCheck size={21} />
                  </span>
                  <span>
                    <strong>{c.holder_name}</strong>
                    <small>
                      {c.contract_number} · {c.vin}
                    </small>
                  </span>
                  <span>
                    <strong>{protectionPlans[c.plan]}</strong>
                    <small>{protectionTermLabel(c)}</small>
                  </span>
                  <span>
                    <strong>{fullMoney(c.price)}</strong>
                    <small>{protectionLabel(c, today)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <ProtectionClaims {...props} onOpenContract={setSelected} />
        </>
      )}
      {issuing && (
        <ProtectionIssue
          {...props}
          onClose={() => setIssuing(false)}
          onIssued={(ids) => {
            setIssuing(false);
            setSelected(ids[0]);
            setPrintingIds(ids);
          }}
        />
      )}
      {printingIds.length > 0 &&
        printingContracts.length === printingIds.length && (
          <ProtectionPDFPreview
            contracts={printingContracts}
            demo={props.demo}
            onClose={() => setPrintingIds([])}
          />
        )}
    </section>
  );
}

export function ProtectionFromQuote({
  quote,
  current,
  ...props
}: Context & { quote: Quote; current: boolean }) {
  const [issuing, setIssuing] = useState(false),
    [printing, setPrinting] = useState(false),
    [viewId, setViewId] = useState("");
  const products = selectedProtectionProducts(quote);
  const contracts = useMemo(
    () =>
      selectedProtectionProducts(quote).flatMap((p) => {
        const c = props.ws.protection_contracts?.find(
          (c) =>
            c.opportunity_id === quote.opportunity_id && c.product_id === p.id,
        );
        return c ? [c] : [];
      }),
    [quote, props.ws.protection_contracts],
  );
  if (!canManage(props.ws.member.role) || !products.length) return null;
  const pending = products.filter(
    (p) => !contracts.some((c) => c.product_id === p.id),
  );
  const changed = products.some((p) => {
    const c = contracts.find((c) => c.product_id === p.id);
    return c && !protectionProductMatches(p, c);
  });
  const viewed = contracts.find((c) => c.id === viewId);
  const outside = (quote.values.products ?? []).filter(
    (p) => !p.protection_plan,
  );
  return (
    <div className="protection-from-quote">
      <div>
        <ShieldCheck size={18} />
        <strong>Contract selected products</strong>
      </div>
      <small>
        {products.length} Drive Max{" "}
        {products.length === 1 ? "product" : "products"} · {contracts.length}{" "}
        already issued · one printable packet
      </small>
      {(!current || changed) && (
        <p className="form-error">
          {changed
            ? "Selected coverage differs from an issued contract. Restore the menu to the issued terms or use a new product for replacement coverage."
            : "Save and select the current F&I menu before issuing coverage."}
        </p>
      )}
      {pending.length > 0 && (
        <button
          type="button"
          className="btn primary small"
          disabled={props.busy || !current || changed}
          onClick={() => setIssuing(true)}
        >
          Contract {pending.length} selected{" "}
          {pending.length === 1 ? "product" : "products"}
        </button>
      )}
      {contracts.length > 0 && (
        <button
          type="button"
          className="btn small"
          onClick={() => setPrinting(true)}
        >
          <FileText size={15} />
          Print{" "}
          {contracts.length === 1 ? "issued contract" : "all issued contracts"}
        </button>
      )}
      <div className="protection-issued-links">
        {contracts.map((c) => (
          <button
            type="button"
            className="text-btn"
            key={c.id}
            onClick={() => setViewId(c.id)}
          >
            {protectionPlans[c.plan]} · {c.contract_number} ·{" "}
            {protectionLabel(c, dayKey())}
          </button>
        ))}
      </div>
      {outside.length > 0 && (
        <small>
          Outside-provider products (
          {outside.map((p) => p.name || p.kind.replaceAll("_", " ")).join(", ")}
          ) require their provider’s contracts and are not in this packet.
        </small>
      )}
      {issuing && (
        <ProtectionIssue
          {...props}
          quote={quote}
          products={pending}
          onClose={() => setIssuing(false)}
          onIssued={() => {
            setIssuing(false);
            setPrinting(true);
          }}
        />
      )}
      {printing && contracts.length > 0 && (
        <ProtectionPDFPreview
          contracts={contracts}
          demo={props.demo}
          onClose={() => setPrinting(false)}
        />
      )}
      {viewed && (
        <Modal
          wide
          title={viewed.contract_number}
          onClose={() => setViewId("")}
        >
          <ProtectionDetail {...props} contract={viewed} />
        </Modal>
      )}
    </div>
  );
}

function ProtectionDetail({
  contract: c,
  onBack,
  ...props
}: Context & { contract: ProtectionContract; onBack?: () => void }) {
  const [action, setAction] = useState<"cancel" | "claim" | "refund" | null>(
      null,
    ),
    [pdf, setPdf] = useState<"contract" | "cancellation" | "packet" | null>(
      null,
    );
  const { ws, busy } = props,
    x = c.cancellation;
  const packet = useMemo(
    () =>
      c.batch_id
        ? (ws.protection_contracts ?? [])
            .filter(
              (x) =>
                x.batch_id === c.batch_id &&
                x.customer_id === c.customer_id &&
                x.vin === c.vin,
            )
            .sort((a, b) => a.contract_number.localeCompare(b.contract_number))
        : [c],
    [c, ws.protection_contracts],
  );
  const usage = protectionUsage(c, ws.protection_events ?? []).reduce(
    (n, u) => n + u.units,
    0,
  );
  const events = (ws.protection_events ?? [])
    .filter((e) => e.contract_id === c.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <div className="protection-detail">
      {onBack && (
        <button className="text-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          All contracts
        </button>
      )}
      <SectionTitle
        title={`${protectionPlans[c.plan]} · ${c.contract_number}`}
        subtitle={`${c.holder_name} · ${c.year} ${c.make} ${c.model}`}
        action={
          <button
            className="btn primary"
            type="button"
            onClick={() => setPdf("contract")}
          >
            <FileText size={16} />
            Print contract
          </button>
        }
      />
      <div className="protection-expiry">
        <ShieldCheck size={23} />
        <div>
          <small>
            {protectionLabel(c, dayKey()).toUpperCase()} · VIN {c.vin}
          </small>
          <strong>
            Expires {c.expires_on}{" "}
            {c.expires_miles === null ? (
              <span>· Unlimited mileage</span>
            ) : (
              <>
                <span>or</span> {c.expires_miles.toLocaleString()} miles
              </>
            )}
          </strong>
          <small>
            {c.expires_miles === null
              ? "Time limit only."
              : "Whichever occurs first."}{" "}
            Verify eligibility before authorizing service.
          </small>
        </div>
      </div>
      <dl className="protection-facts">
        <div>
          <dt>Coverage starts</dt>
          <dd>
            {c.issued_on} · {c.start_miles.toLocaleString()} miles
          </dd>
        </div>
        <div>
          <dt>Purchased term</dt>
          <dd>{protectionTermLabel(c)}</dd>
        </div>
        <div>
          <dt>Contract price</dt>
          <dd>{fullMoney(c.price)}</dd>
        </div>
        <div>
          <dt>Deductible per visit</dt>
          <dd>{fullMoney(c.deductible)}</dd>
        </div>
        <div>
          <dt>Benefit limit</dt>
          <dd>
            {c.plan === "key_replacement"
              ? "3 keys total · 2 per rolling 12 months"
              : c.plan === "maintenance"
                ? `${c.maintenance_visits} visits · $125 per visit`
                : c.claim_limit === null
                  ? "No aggregate dollar limit"
                  : fullMoney(c.claim_limit)}
          </dd>
        </div>
        <div>
          <dt>Paid claims / benefit remaining</dt>
          <dd>
            {fullMoney(c.claims_paid)} /{" "}
            {c.plan === "key_replacement"
              ? `${3 - usage} keys remaining (rolling limit also applies)`
              : c.plan === "maintenance"
                ? `${(c.maintenance_visits ?? 0) - usage} visits remaining`
                : c.claim_limit === null
                  ? "No aggregate dollar limit"
                  : fullMoney(c.claim_limit - c.claims_paid)}
          </dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>
            {c.phone} · {c.email || "No email"}
          </dd>
        </div>
        <div>
          <dt>Lienholder</dt>
          <dd>{c.lender || "None recorded"}</dd>
        </div>
      </dl>
      <p className="ops-help">{protectionDescriptions[c.plan]}</p>
      {x && (
        <section className="protection-cancellation">
          <h3>
            Canceled {x.canceled_on} · {x.mileage.toLocaleString()} miles
          </h3>
          <RefundBreakdown value={x} unlimited={c.term_miles === null} />
          <p>
            {x.reason} · Payee: {x.payee}
          </p>
          <strong>
            {x.paid_on
              ? `Refund recorded paid ${x.paid_on} · ${x.payment_reference}`
              : x.refund > 0
                ? "Refund due — payment not recorded"
                : "No refund due"}
          </strong>
        </section>
      )}
      <div className="ops-actions">
        {packet.length > 1 && (
          <button
            type="button"
            className="btn"
            onClick={() => setPdf("packet")}
          >
            <FileText size={16} />
            Print all {packet.length} contracts from this packet
          </button>
        )}
        {c.status !== "canceled" ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setAction("claim")}
            >
              Record paid claim
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setAction("cancel")}
            >
              Cancel contract
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setPdf("cancellation")}
            >
              Print cancellation
            </button>
            {x && !x.paid_on && x.refund > 0 && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setAction("refund")}
              >
                Record refund paid
              </button>
            )}
          </>
        )}
      </div>
      <h3>Contract history</h3>
      <ol className="protection-history">
        {events.map((e) => (
          <li key={e.id}>
            <strong>{actions[e.action] ?? e.action}</strong>
            <small>
              {stamp(e.created_at)} ·{" "}
              {ws.staff.find(
                (s) => s.user_id === e.created_by || s.id === e.created_by,
              )?.name ?? "CRM manager"}
            </small>
            {!!e.command.reference && (
              <span>
                Reference: {String(e.command.reference)}
                {e.command.amount
                  ? ` · ${fullMoney(Number(e.command.amount))}`
                  : ""}
              </span>
            )}
            {!!e.command.service_on && (
              <span>
                Service: {String(e.command.service_on)} ·{" "}
                {Number(e.command.mileage).toLocaleString()} miles ·{" "}
                {String(e.command.units)}{" "}
                {c.plan === "key_replacement" ? "key(s)" : "visit"}
              </span>
            )}
            {!!e.command.description && (
              <span>{String(e.command.description)}</span>
            )}
          </li>
        ))}
      </ol>
      <ProtectionClaims {...props} contractId={c.id} />
      {action && (
        <ProtectionTransaction
          key={`${c.id}-${c.revision}-${action}`}
          {...props}
          contract={c}
          action={action}
          onClose={() => setAction(null)}
        />
      )}
      {pdf && (
        <ProtectionPDFPreview
          contract={pdf === "packet" ? undefined : c}
          contracts={pdf === "packet" ? packet : undefined}
          demo={props.demo}
          cancellation={pdf === "cancellation"}
          onClose={() => setPdf(null)}
        />
      )}
    </div>
  );
}
function RefundBreakdown({
  value: x,
  unlimited = false,
}: {
  unlimited?: boolean;
  value: ReturnType<typeof protectionRefund>;
}) {
  return (
    <dl className="protection-refund">
      <div>
        <dt>Time used</dt>
        <dd>{(x.time_used * 100).toFixed(2)}%</dd>
      </div>
      <div>
        <dt>Mileage used</dt>
        <dd>
          {unlimited
            ? "Unlimited · time only"
            : `${(x.mileage_used * 100).toFixed(2)}%`}
        </dd>
      </div>
      <div>
        <dt>Prorated amount</dt>
        <dd>{fullMoney(x.prorated)}</dd>
      </div>
      <div>
        <dt>Administration fee</dt>
        <dd>− {fullMoney(x.admin_fee)}</dd>
      </div>
      <div>
        <dt>Paid claims</dt>
        <dd>− {fullMoney(x.claims_paid)}</dd>
      </div>
      <div className="protection-refund-total">
        <dt>Customer / lender refund</dt>
        <dd>{fullMoney(x.refund)}</dd>
      </div>
    </dl>
  );
}
function ProtectionTransaction({
  contract: c,
  action,
  run,
  busy,
  onClose,
}: Context & {
  contract: ProtectionContract;
  action: "cancel" | "claim" | "refund";
  onClose: () => void;
}) {
  const [date, setDate] = useState(dayKey()),
    [miles, setMiles] = useState(""),
    [reason, setReason] = useState(""),
    [payee, setPayee] = useState(c.lender || c.holder_name),
    [amount, setAmount] = useState(""),
    [serviceOn, setServiceOn] = useState(dayKey()),
    [units, setUnits] = useState("1"),
    [reference, setReference] = useState(""),
    [paidFromFund, setPaidFromFund] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    keyFor = useRequestKey();
  let calculation: ReturnType<typeof protectionRefund> | null = null,
    calculationError = "";
  if (action === "cancel" && date && miles.trim())
    try {
      calculation = protectionRefund(c, date, Number(miles));
    } catch (e) {
      calculationError =
        e instanceof Error ? e.message : "Check date and mileage.";
    }
  return (
    <Modal
      title={
        action === "cancel"
          ? "Cancel protection contract"
          : action === "claim"
            ? "Record a paid claim / service"
            : "Record refund payment"
      }
      subtitle={c.contract_number}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="modal-form protection-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          let payload:
            | Omit<
                Extract<Command, { type: "cancel_protection" }>,
                "request_id"
              >
            | Omit<
                Extract<Command, { type: "record_protection_claim" }>,
                "request_id"
              >
            | Omit<
                Extract<Command, { type: "record_protection_refund" }>,
                "request_id"
              >;
          const base = { id: c.id, revision: c.revision };
          if (action === "cancel") {
            if (!calculation || !confirmed) return;
            payload = {
              ...base,
              type: "cancel_protection",
              canceled_on: date,
              mileage: Number(miles),
              reason,
              payee,
            };
          } else if (action === "claim")
            payload = {
              ...base,
              type: "record_protection_claim",
              paid_from_fund: paidFromFund,
              paid_on: date,
              amount: Number(amount),
              reference,
              description: reason,
              service_on: serviceOn,
              mileage: Number(miles),
              units: Number(units),
            };
          else
            payload = {
              ...base,
              type: "record_protection_refund",
              paid_from_fund: paidFromFund,
              paid_on: date,
              reference,
            };
          const result = await run(
            { ...payload, request_id: keyFor(payload) },
            action === "cancel"
              ? "Contract canceled; refund recorded as due"
              : "Payment recorded",
          );
          if (result.ok) onClose();
          else setError(result.error ?? "Unable to save.");
        }}
      >
        <label>
          {action === "cancel" ? "Cancellation effective date" : "Payment date"}
          <input
            type="date"
            required
            min={
              action === "refund" ? c.cancellation!.canceled_on : c.issued_on
            }
            max={dayKey()}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        {action === "cancel" ? (
          <>
            <label>
              Current odometer (miles)
              <input
                type="number"
                required
                min={c.start_miles}
                max={6000000}
                step="1"
                value={miles}
                onChange={(e) => {
                  setMiles(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              Reason for cancellation
              <input
                required
                minLength={3}
                maxLength={250}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              Refund payee
              <input
                required
                maxLength={250}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </label>
            {calculation && (
              <RefundBreakdown
                value={calculation}
                unlimited={c.term_miles === null}
              />
            )}
            <p className="ops-help">
              {c.term_miles === null
                ? "Uses time consumed; mileage is unlimited."
                : "Uses the greater of time or mileage consumed."}{" "}
              Administration fee: $100, capped at 10% of the prorated amount
              under NC rules. Paid claims reduce the refund. Recording
              cancellation does not send payment.
            </p>
            <label className="protection-check">
              <input
                type="checkbox"
                checked={confirmed}
                required
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              The customer requested cancellation, and I verified the date,
              mileage and payee.
            </label>
          </>
        ) : (
          <>
            {action === "claim" ? (
              <>
                <label>
                  Service / replacement date
                  <input
                    type="date"
                    required
                    min={c.issued_on}
                    max={
                      date < c.expires_on
                        ? date
                        : new Date(
                            Date.parse(c.expires_on + "T12:00:00Z") - 86400000,
                          )
                            .toISOString()
                            .slice(0, 10)
                    }
                    value={serviceOn}
                    onChange={(e) => setServiceOn(e.target.value)}
                  />
                </label>
                <label>
                  Odometer at service
                  <input
                    type="number"
                    required
                    min={c.start_miles}
                    max={
                      c.expires_miles === null ? 6000000 : c.expires_miles - 1
                    }
                    step="1"
                    value={miles}
                    onChange={(e) => setMiles(e.target.value)}
                  />
                </label>
                {c.plan === "key_replacement" && (
                  <label>
                    Keys replaced
                    <select
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                    >
                      <option value="1">1 key</option>
                      <option value="2">2 keys</option>
                    </select>
                    <small>
                      3 total; no more than 2 in any rolling 12 months.
                    </small>
                  </label>
                )}
                {c.plan === "maintenance" && (
                  <p className="ops-help">
                    One visit includes oil/filter change and tire rotation, up
                    to $125 combined. Recording a claim uses one included visit.
                  </p>
                )}
                <label>
                  Amount actually paid
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={
                      c.plan === "maintenance"
                        ? 125
                        : c.claim_limit === null
                          ? 1000000
                          : c.claim_limit - c.claims_paid
                    }
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Repair / claim description
                  <textarea
                    required
                    minLength={3}
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p className="ops-help">
                  Record a completed payment. This amount reduces the remaining
                  repair benefit and any later cancellation refund.
                </p>
              </>
            ) : (
              <p>
                Record <strong>{fullMoney(c.cancellation!.refund)}</strong> paid
                to <strong>{c.cancellation!.payee}</strong>. This records a
                payment made outside the CRM.
              </p>
            )}
            <label className="protection-check">
              <input
                type="checkbox"
                checked={paidFromFund}
                onChange={(e) => setPaidFromFund(e.target.checked)}
              />
              Paid from the protection claims fund. Record this withdrawal in
              Accounting.
            </label>
            <label>
              Check, transaction or claim reference
              <input
                required
                maxLength={250}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </>
        )}
        {(error || calculationError) && (
          <p role="alert" className="form-error">
            {error || calculationError}
          </p>
        )}
        <button
          className="btn primary"
          disabled={
            busy || (action === "cancel" && (!calculation || !confirmed))
          }
        >
          {action === "cancel"
            ? "Confirm cancellation"
            : action === "claim"
              ? "Record paid claim"
              : "Record refund paid"}
        </button>
      </form>
    </Modal>
  );
}
