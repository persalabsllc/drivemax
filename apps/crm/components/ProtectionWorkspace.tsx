"use client";
import { useRef, useState } from "react";
import { ArrowLeft, Plus, ShieldCheck, FileText, Search } from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Workspace,
  type Quote,
  type Command,
} from "../lib/model";
import type { FIProduct } from "../lib/operations";
import {
  protectionDefaults,
  protectionDeductibles,
  protectionExpiry,
  protectionInputSchema,
  protectionIssuer,
  protectionLabel,
  protectionPlans,
  protectionRefund,
  protectionVersion,
  selectedProtectionProducts,
  type ProtectionContract,
  type ProtectionInput,
} from "../lib/protection";
import { Modal, Empty, SectionTitle } from "./ui";
import type { ManagementRun } from "./ServiceWorkspace";
import { ProtectionPDFPreview } from "./ProtectionPDFPreview";

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
    [issuing, setIssuing] = useState(false);
  const { ws } = props;
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
            subtitle="Issue coverage, find a contract, or calculate a cancellation."
            action={
              <button className="btn primary" onClick={() => setIssuing(true)}>
                <Plus size={16} />
                Issue service contract
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
                  : "Issue Deluxe or Platinum coverage here, or from the customer's selected F&I menu in Desking."
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
                    <small>
                      {c.term_months} months / {c.term_miles.toLocaleString()}{" "}
                      miles
                    </small>
                  </span>
                  <span>
                    <strong>{fullMoney(c.price)}</strong>
                    <small>{protectionLabel(c, today)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {issuing && (
        <ProtectionIssue
          {...props}
          onClose={() => setIssuing(false)}
          onIssued={(id) => {
            setIssuing(false);
            setSelected(id);
          }}
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
  const [product, setProduct] = useState<FIProduct | null>(null),
    [viewId, setViewId] = useState("");
  if (!canManage(props.ws.member.role)) return null;
  const products = selectedProtectionProducts(quote),
    contract = props.ws.protection_contracts?.find((c) => c.id === viewId);
  if (!products.length) return null;
  return (
    <div className="protection-from-quote">
      <div>
        <ShieldCheck size={18} />
        <strong>Issue selected coverage</strong>
      </div>
      {!current && (
        <small>
          Save and select the current F&I menu before issuing coverage.
        </small>
      )}
      {products.map((p) => {
        const existing = props.ws.protection_contracts?.find(
          (c) =>
            c.opportunity_id === quote.opportunity_id && c.product_id === p.id,
        );
        return (
          <button
            type="button"
            key={p.id}
            className="btn small"
            disabled={props.busy || (!existing && !current)}
            onClick={() => (existing ? setViewId(existing.id) : setProduct(p))}
          >
            <FileText size={15} />
            {existing
              ? `${existing.contract_number} · ${protectionLabel(existing, dayKey())}`
              : `Issue ${protectionPlans[p.protection_plan!]} contract`}
          </button>
        );
      })}
      {product && (
        <ProtectionIssue
          {...props}
          quote={quote}
          product={product}
          onClose={() => setProduct(null)}
          onIssued={(id) => {
            setProduct(null);
            setViewId(id);
          }}
        />
      )}
      {contract && (
        <Modal
          wide
          title={contract.contract_number}
          onClose={() => setViewId("")}
        >
          <ProtectionDetail {...props} contract={contract} />
        </Modal>
      )}
    </div>
  );
}

function ProtectionIssue({
  ws,
  run,
  busy,
  demo,
  quote,
  product,
  onClose,
  onIssued,
}: Context & {
  quote?: Quote;
  product?: FIProduct;
  onClose: () => void;
  onIssued: (id: string) => void;
}) {
  const [id] = useState(() => crypto.randomUUID()),
    keyFor = useRequestKey();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const customer = ws.customers.find((c) => c.id === quote?.customer_id),
      d = protectionDefaults(customer, quote);
    if (product)
      Object.assign(d, {
        quote_id: quote!.id,
        product_id: product.id,
        plan: product.protection_plan,
        deductible: product.deductible,
        price: product.price,
        term_months: product.term_months,
        term_miles: product.mileage_limit,
      });
    return {
      ...Object.fromEntries(
        Object.entries(d).map(([k, v]) => [
          k,
          v === null || v === undefined ? "" : String(v),
        ]),
      ),
      issued_on: dayKey(),
    };
  });
  const [confirmed, setConfirmed] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ProtectionContract | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const update = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setReviewed(false);
    setError("");
  };
  const linked = !!quote;
  function input() {
    const raw: Record<string, unknown> = {
      ...values,
      opportunity_id: quote?.opportunity_id ?? null,
      quote_id: quote?.id ?? null,
      product_id: product?.id ?? null,
      dealer_sold: confirmed,
    };
    for (const k of [
      "year",
      "deductible",
      "price",
      "start_miles",
      "term_months",
      "term_miles",
      "claim_limit",
    ])
      raw[k] = values[k]?.trim() ? Number(values[k]) : undefined;
    const result = protectionInputSchema.safeParse(raw);
    if (!result.success) {
      setError(
        result.error.issues
          .map((x) => `${x.path.join(" ").replaceAll("_", " ")}: ${x.message}`)
          .slice(0, 3)
          .join(" · "),
      );
      return null;
    }
    if (result.data.issued_on > dayKey()) {
      setError("Issue date cannot be in the future.");
      return null;
    }
    return result.data;
  }
  function draft(c: ProtectionInput): ProtectionContract {
    return {
      ...c,
      id,
      org_id: ws.org.id,
      contract_number: "DRAFT",
      expires_on: protectionExpiry(c.issued_on, c.term_months),
      expires_miles: c.start_miles + c.term_miles,
      status: "active",
      terms_version: protectionVersion,
      issuer: protectionIssuer,
      claims_paid: 0,
      cancellation: null,
      revision: 1,
      created_at: new Date().toISOString(),
      created_by: ws.member.id,
    };
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
    locked = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={values[key] ?? ""}
        required={required}
        readOnly={locked}
        maxLength={key === "vin" ? 17 : 250}
        min={
          type === "number"
            ? ["year"].includes(key)
              ? 1900
              : ["price", "claim_limit"].includes(key)
                ? 0.01
                : ["term_months", "term_miles"].includes(key)
                  ? 1
                  : 0
            : undefined
        }
        max={
          type === "date" ? dayKey() : key === "term_months" ? 120 : undefined
        }
        step={
          type === "number"
            ? ["price", "claim_limit"].includes(key)
              ? "0.01"
              : "1"
            : undefined
        }
        onChange={(e) =>
          update(
            key,
            key === "vin" ? e.target.value.toUpperCase() : e.target.value,
          )
        }
      />
    </label>
  );
  let expiry = "",
    miles = "";
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(values.issued_on ?? "") &&
    Number(values.term_months) > 0 &&
    Number(values.term_months) <= 120
  )
    try {
      expiry = protectionExpiry(values.issued_on, Number(values.term_months));
    } catch {}
  if (values.start_miles?.trim() && Number(values.term_miles) > 0)
    miles = (
      Number(values.start_miles) + Number(values.term_miles)
    ).toLocaleString();
  return (
    <Modal
      wide
      title={linked ? "Contract selected coverage" : "Issue service contract"}
      subtitle="Drive Max Protection · North Carolina · Required fields must be completed before issuance."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        ref={form}
        className="modal-form protection-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const c = input();
          if (!c || !reviewed) return;
          // Build once before saving so an unprintable registration cannot be issued.
          try {
            const { buildProtectionPdf } =
              await import("../lib/protection-pdf");
            await buildProtectionPdf(draft(c), undefined, true);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not validate contract PDF.",
            );
            return;
          }
          const payload = {
            type: "issue_protection" as const,
            id,
            contract: c,
          };
          const result = await run(
            { ...payload, request_id: keyFor(payload) },
            "Service contract issued",
          );
          if (result.ok) onIssued(result.id ?? id);
          else setError(result.error ?? "Unable to issue contract.");
        }}
      >
        <fieldset disabled={busy}>
          <legend>Contract holder</legend>
          <label>
            CRM customer
            <select
              required
              disabled={linked}
              value={values.customer_id ?? ""}
              onChange={(e) => {
                const c = ws.customers.find((c) => c.id === e.target.value);
                const d = protectionDefaults(c);
                setValues((v) => ({
                  ...v,
                  ...Object.fromEntries(
                    Object.entries(d)
                      .filter(
                        ([k]) =>
                          !["plan", "deductible", "claim_limit"].includes(k),
                      )
                      .map(([k, v]) => [
                        k,
                        v === null || v === undefined ? "" : String(v),
                      ]),
                  ),
                }));
                setConfirmed(false);
                setReviewed(false);
              }}
            >
              <option value="">Choose customer</option>
              {ws.customers
                .filter((c) => !c.merged_into)
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name} · {c.phone || c.email}
                  </option>
                ))}
            </select>
          </label>
          <div className="ops-form-grid">
            {field("holder_name", "Contract holder")}
            {field("co_holder", "Co-holder (optional)", "text", false)}
            {field("address", "Street address")}
            {field("city", "City")}
            <label>
              State
              <input value="North Carolina" readOnly />
            </label>
            {field("zip", "ZIP code")}
            {field("phone", "Phone")}
            {field("email", "Email (optional)", "email", false)}
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Vehicle & coverage</legend>
          <div className="ops-form-grid">
            {field("vin", "VIN")}
            {field("year", "Year", "number")}
            {field("make", "Make")}
            {field("model", "Model")}
            {field("stock_number", "Stock # (optional)", "text", false)}
            <label>
              Coverage plan
              <select
                value={values.plan ?? "deluxe"}
                disabled={linked}
                onChange={(e) => update("plan", e.target.value)}
              >
                {Object.entries(protectionPlans).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Deductible per repair visit
              <select
                value={values.deductible ?? "0"}
                disabled={linked}
                onChange={(e) => update("deductible", e.target.value)}
              >
                {protectionDeductibles.map((d) => (
                  <option key={d} value={d}>
                    {fullMoney(d)}
                  </option>
                ))}
              </select>
            </label>
            {field("price", "Contract price", "number", true, linked)}
            {field("issued_on", "Issue / coverage start date", "date")}
            {field("start_miles", "Starting odometer (miles)", "number")}
            {field("term_months", "Term (months)", "number", true, linked)}
            {field(
              "term_miles",
              "Additional covered miles",
              "number",
              true,
              linked,
            )}
            {field("claim_limit", "Aggregate repair benefit limit", "number")}
          </div>
          <p className="ops-help">
            {values.plan === "platinum"
              ? "Platinum: listed powertrain components plus alternator, water pump, thermostat, listed sensors and engine accessories."
              : "Deluxe: listed engine, transmission, transfer case and drive axle powertrain components."}{" "}
            Review the full component list and exclusions in the contract.
          </p>
          <div className="protection-expiry">
            <ShieldCheck size={21} />
            <div>
              <small>COVERAGE EXPIRES — WHICHEVER OCCURS FIRST</small>
              <strong>
                {expiry || "Enter date and term"} <span>or</span>{" "}
                {miles ? `${miles} miles` : "Enter odometer and miles"}
              </strong>
            </div>
          </div>
          {linked && (
            <p className="ops-help">
              Plan, deductible, price and term come from the selected F&I menu.
              Change and apply the menu first to revise them.
            </p>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Lienholder</legend>
          <div className="ops-form-grid">
            {field("lender", "Lender (optional)", "text", false)}
            {field(
              "lender_address",
              "Lender address (optional)",
              "text",
              false,
            )}
          </div>
        </fieldset>
        <label className="protection-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              setReviewed(false);
            }}
          />
          This vehicle was sold by Drive Max to this North Carolina customer.
        </label>
        <label className="protection-check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I have verified the customer, coverage, price and repair-benefit
          limit. Issued terms cannot be edited.
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="ops-actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!form.current?.reportValidity()) return;
              const c = input();
              if (c) setPreview(draft(c));
            }}
          >
            Preview 5-page contract
          </button>
          <button
            className="btn primary"
            disabled={busy || !reviewed || !confirmed}
          >
            Issue contract
          </button>
        </div>
      </form>
      {preview && (
        <ProtectionPDFPreview
          contract={preview}
          demo={demo}
          draft
          onClose={() => setPreview(null)}
        />
      )}
    </Modal>
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
    [pdf, setPdf] = useState<"contract" | "cancellation" | null>(null);
  const { ws, busy } = props,
    x = c.cancellation;
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
            Expires {c.expires_on} <span>or</span>{" "}
            {c.expires_miles.toLocaleString()} miles
          </strong>
          <small>
            Whichever occurs first. Verify current mileage before authorizing
            repairs.
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
          <dd>
            {c.term_months} months / {c.term_miles.toLocaleString()} additional
            miles
          </dd>
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
          <dt>Repair benefit limit</dt>
          <dd>{fullMoney(c.claim_limit)}</dd>
        </div>
        <div>
          <dt>Paid claims / benefit remaining</dt>
          <dd>
            {fullMoney(c.claims_paid)} /{" "}
            {fullMoney(c.claim_limit - c.claims_paid)}
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
      {x && (
        <section className="protection-cancellation">
          <h3>
            Canceled {x.canceled_on} · {x.mileage.toLocaleString()} miles
          </h3>
          <RefundBreakdown value={x} />
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
            {!!e.command.description && (
              <span>{String(e.command.description)}</span>
            )}
          </li>
        ))}
      </ol>
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
          contract={c}
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
}: {
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
        <dd>{(x.mileage_used * 100).toFixed(2)}%</dd>
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
    [reference, setReference] = useState(""),
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
          ? "Cancel service contract"
          : action === "claim"
            ? "Record a paid repair claim"
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
              paid_on: date,
              amount: Number(amount),
              reference,
              description: reason,
            };
          else
            payload = {
              ...base,
              type: "record_protection_refund",
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
            {calculation && <RefundBreakdown value={calculation} />}
            <p className="ops-help">
              Uses the greater of time or mileage consumed. Administration fee:
              $100, capped at 10% of the prorated amount under NC rules. Paid
              claims reduce the refund. Recording cancellation does not send
              payment.
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
                  Amount actually paid
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={c.claim_limit - c.claims_paid}
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
