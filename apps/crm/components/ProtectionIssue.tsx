"use client";
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { dayKey, fullMoney, type Workspace, type Quote } from "../lib/model";
import type { FIProduct } from "../lib/operations";
import { protectionCost } from "../lib/protection-pricing";
import type { ManagementRun } from "./ServiceWorkspace";
import { Modal } from "./ui";
import { ProtectionCostSummary } from "./ProtectionCostSummary";
import { ProtectionTermChoices } from "./ProtectionTermChoices";
import { ProtectionPDFPreview } from "./ProtectionPDFPreview";
import {
  protectionDefaults,
  protectionDeductibles,
  protectionDraft,
  protectionExpiry,
  protectionInputSchema,
  protectionPlans,
  protectionProductInput,
  protectionTermLabel,
  type ProtectionContract,
  type ProtectionInput,
} from "../lib/protection";
import {
  isMechanicalPlan,
  protectionDescriptions,
  type ProtectionPlan,
} from "../lib/protection-programs";

type Props = {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  demo: boolean;
  quote?: Quote;
  products?: FIProduct[];
  onClose: () => void;
  onIssued: (ids: string[]) => void;
};
const strings = (d: object) =>
  Object.fromEntries(
    Object.entries(d).map(([k, v]) => [k, v == null ? "" : String(v)]),
  );
export function ProtectionIssue({
  ws,
  run,
  busy,
  demo,
  quote,
  products,
  onClose,
  onIssued,
}: Props) {
  const [ids] = useState(() =>
    Array.from({ length: products?.length ?? 1 }, () => crypto.randomUUID()),
  );
  const [batchId] = useState(() => crypto.randomUUID());
  const request = useRef({ payload: "", id: "" });
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...strings(
      protectionDefaults(
        ws.customers.find((c) => c.id === quote?.customer_id),
        quote,
      ),
    ),
    issued_on: dayKey(),
  }));
  const [confirmed, setConfirmed] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ProtectionContract[] | null>(null),
    [saving, setSaving] = useState(false);
  const form = useRef<HTMLFormElement>(null),
    submitting = useRef(false);
  const linked = !!quote,
    blocked = busy || saving,
    plan = (values.plan || "deluxe") as ProtectionPlan,
    mechanical = isMechanicalPlan(plan);
  const update = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setReviewed(false);
    setError("");
  };
  const unlimited = plan === "appearance" || values.unlimited_miles === "true";
  const pricing = ws.product_pricing?.[0];
  const allocation =
    !linked && pricing?.active && pricing.active_revision
      ? protectionCost(
          {
            protection_plan: plan,
            term_months: Number(values.term_months),
            mileage_limit: Number(values.term_miles),
            unlimited_miles: unlimited,
            maintenance_visits: Number(values.maintenance_visits),
            deductible: Number(values.deductible ?? 0),
            price: Number(values.price),
          },
          pricing.active,
          pricing.active_revision,
        )
      : null;
  function inputs(): ProtectionInput[] | null {
    const common = {
      ...values,
      opportunity_id: quote?.opportunity_id ?? null,
      quote_id: quote?.id ?? null,
      product_id: null,
      dealer_sold: confirmed,
      year: values.year?.trim() ? Number(values.year) : undefined,
      start_miles: values.start_miles?.trim()
        ? Number(values.start_miles)
        : undefined,
    };
    const coverages = products?.map((p) => {
      const coverage = protectionProductInput(p);
      return {
        ...coverage,
        claim_limit:
          coverage.claim_limit === undefined
            ? Number(values.claim_limit)
            : coverage.claim_limit,
      };
    }) ?? [
      {
        plan,
        deductible: Number(values.deductible ?? 0),
        price: Number(values.price),
        term_months: Number(values.term_months),
        term_miles: unlimited ? null : Number(values.term_miles),
        maintenance_visits:
          plan === "maintenance" ? Number(values.maintenance_visits) : null,
        claim_limit: mechanical
          ? Number(values.claim_limit)
          : plan === "maintenance"
            ? Number(values.maintenance_visits) * 125
            : null,
      },
    ];
    const result: ProtectionInput[] = [];
    for (const coverage of coverages) {
      const parsed = protectionInputSchema.safeParse({
        ...common,
        ...coverage,
      });
      if (!parsed.success) {
        setError(
          `${protectionPlans[coverage.plan]}: ${parsed.error.issues
            .slice(0, 2)
            .map(
              (x) => `${x.path.join(" ").replaceAll("_", " ")}: ${x.message}`,
            )
            .join(" · ")}`,
        );
        return null;
      }
      if (parsed.data.issued_on > dayKey()) {
        setError("Issue date cannot be in the future.");
        return null;
      }
      result.push(parsed.data);
    }
    return result;
  }
  const draft = (items: ProtectionInput[]) =>
    items.map((c, i) => ({ ...protectionDraft(c), id: ids[i] }));
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
            ? key === "year"
              ? 1900
              : ["price", "claim_limit"].includes(key)
                ? 0.01
                : ["term_months", "term_miles", "maintenance_visits"].includes(
                      key,
                    )
                  ? 1
                  : 0
            : undefined
        }
        max={
          type === "date"
            ? dayKey()
            : key === "term_months"
              ? 120
              : key === "maintenance_visits"
                ? 100
                : undefined
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
  const expiry = (months: number) => {
    try {
      return /^\d{4}-\d{2}-\d{2}$/.test(values.issued_on) &&
        months > 0 &&
        months <= 120
        ? protectionExpiry(values.issued_on, months)
        : "Enter date and term";
    } catch {
      return "Enter date and term";
    }
  };
  const endMiles = (miles: number | null) =>
    miles === null
      ? "Unlimited mileage"
      : values.start_miles?.trim() && miles > 0
        ? `${(Number(values.start_miles) + miles).toLocaleString()} miles`
        : "Enter starting odometer and miles";
  return (
    <Modal
      wide
      title={
        linked ? "Contract selected products" : "Issue protection contract"
      }
      subtitle={
        linked
          ? "One customer and vehicle review. Coverage and prices come from the selected F&I menu."
          : "Drive Max Protection · North Carolina"
      }
      onClose={() => {
        if (!blocked) onClose();
      }}
    >
      {!linked && (
        <p className="ops-help">
          {allocation
            ? "Coverage costs and claims funding are shown below. These amounts are excluded from the contract PDF."
            : "Automatic cost schedule is inactive or coverage is incomplete. No new cost will be assumed for this standalone contract."}
        </p>
      )}
      <form
        ref={form}
        className="modal-form protection-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || blocked) return;
          setError("");
          const contracts = inputs();
          if (!contracts || !reviewed) return;
          submitting.current = true;
          setSaving(true);
          try {
            const { buildProtectionPacketPdf } =
              await import("../lib/protection-pdf");
            await buildProtectionPacketPdf(draft(contracts), undefined, true);
            const payload = linked
              ? {
                  type: "issue_protection_batch" as const,
                  id: batchId,
                  contracts: contracts.map((contract, i) => ({
                    id: ids[i],
                    contract,
                  })),
                }
              : {
                  type: "issue_protection" as const,
                  id: ids[0],
                  contract: contracts[0],
                };
            const serialized = JSON.stringify(payload);
            if (request.current.payload !== serialized)
              request.current = {
                payload: serialized,
                id: crypto.randomUUID(),
              };
            const result = await run(
              { ...payload, request_id: request.current.id },
              `${contracts.length === 1 ? "Contract" : `${contracts.length} contracts`} issued`,
            );
            if (result.ok) onIssued(ids);
            else setError(result.error ?? "Unable to issue contracts.");
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not prepare the contracts.",
            );
          } finally {
            submitting.current = false;
            setSaving(false);
          }
        }}
      >
        {products && (
          <fieldset disabled={blocked}>
            <legend>Selected products · {products.length} new contracts</legend>
            <div className="protection-product-summary">
              {products.map((p) => {
                const c = protectionProductInput(p);
                return (
                  <article key={p.id}>
                    <div>
                      <strong>{protectionPlans[c.plan]}</strong>
                      <b>{fullMoney(p.price)}</b>
                    </div>
                    <p>{protectionDescriptions[c.plan]}</p>
                    <small>
                      {protectionTermLabel(c)} · {fullMoney(c.deductible)}{" "}
                      deductible
                      {c.maintenance_visits
                        ? ` · ${c.maintenance_visits} visits`
                        : ""}
                    </small>
                    {isMechanicalPlan(c.plan) && c.claim_limit != null && (
                      <small>
                        Aggregate repair benefit: {fullMoney(c.claim_limit)}
                      </small>
                    )}
                    <small className="protection-product-expiry">
                      Expires {expiry(c.term_months)}
                      {c.term_miles === null ? " · " : " or "}
                      {endMiles(c.term_miles)}
                    </small>
                  </article>
                );
              })}
            </div>
            <p className="ops-help">
              To change coverage, price or term, return to the F&I menu and
              apply the updated selection.
            </p>
          </fieldset>
        )}
        <fieldset disabled={blocked}>
          <legend>Contract holder · shared by all products</legend>
          <label>
            CRM customer
            <select
              required
              disabled={linked}
              value={values.customer_id ?? ""}
              onChange={(e) => {
                const d = protectionDefaults(
                  ws.customers.find((c) => c.id === e.target.value),
                );
                setValues((v) => ({
                  ...v,
                  ...strings(
                    Object.fromEntries(
                      Object.entries(d).filter(
                        ([k]) =>
                          !["plan", "deductible", "claim_limit"].includes(k),
                      ),
                    ),
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
        <fieldset disabled={blocked}>
          <legend>Vehicle and coverage start · enter once</legend>
          <div className="ops-form-grid">
            {field("vin", "VIN")}
            {field("year", "Year", "number")}
            {field("make", "Make")}
            {field("model", "Model")}
            {field("stock_number", "Stock # (optional)", "text", false)}
            {field("issued_on", "Issue / coverage start date", "date")}
            {field("start_miles", "Starting odometer (miles)", "number")}
            {products?.some(
              (p) =>
                isMechanicalPlan(p.protection_plan!) &&
                p.claim_limit === undefined,
            ) &&
              field(
                "claim_limit",
                "Mechanical contract aggregate repair benefit limit",
                "number",
              )}
          </div>
        </fieldset>
        {!linked && (
          <fieldset disabled={blocked}>
            <legend>Product and benefits</legend>
            {mechanical && (
              <ProtectionTermChoices
                months={Number(values.term_months)}
                miles={Number(values.term_miles)}
                annualMiles={pricing?.active?.annual_miles}
                disabled={blocked}
                onChange={(months, miles) => {
                  setValues((v) => ({
                    ...v,
                    term_months: String(months),
                    term_miles: String(miles),
                  }));
                  setReviewed(false);
                  setError("");
                }}
              />
            )}
            <div className="ops-form-grid">
              <label>
                Coverage plan
                <select
                  value={plan}
                  onChange={(e) => {
                    const next = e.target.value as ProtectionPlan;
                    setValues((v) => ({
                      ...v,
                      plan: next,
                      deductible: isMechanicalPlan(next) ? v.deductible : "0",
                      term_months: next === "appearance" ? "96" : v.term_months,
                      unlimited_miles: next === "appearance" ? "true" : "false",
                      maintenance_visits: "",
                    }));
                    setReviewed(false);
                  }}
                >
                  {Object.entries(protectionPlans).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {field("price", "Contract price", "number")}
              {field(
                "term_months",
                "Term (months)",
                "number",
                true,
                plan === "appearance",
              )}
              {!mechanical && (
                <label>
                  Coverage mileage
                  <select
                    disabled={plan === "appearance"}
                    value={unlimited ? "true" : "false"}
                    onChange={(e) => update("unlimited_miles", e.target.value)}
                  >
                    <option value="false">Additional mile allowance</option>
                    <option value="true">Unlimited mileage</option>
                  </select>
                </label>
              )}
              {!unlimited &&
                field("term_miles", "Additional covered miles", "number")}
              {mechanical ? (
                <>
                  <label>
                    Deductible per repair visit
                    <select
                      value={values.deductible ?? "0"}
                      onChange={(e) => update("deductible", e.target.value)}
                    >
                      {protectionDeductibles.map((d) => (
                        <option key={d} value={d}>
                          {fullMoney(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field(
                    "claim_limit",
                    "Aggregate repair benefit limit",
                    "number",
                  )}
                </>
              ) : (
                <label>
                  Deductible
                  <input value="$0" readOnly />
                </label>
              )}
              {plan === "maintenance" &&
                field(
                  "maintenance_visits",
                  "Included maintenance visits",
                  "number",
                )}
            </div>
            {allocation && (
              <ProtectionCostSummary
                snapshot={allocation}
                price={Number(values.price)}
              />
            )}
            <p className="ops-help">
              {protectionDescriptions[plan]} See the agreement for coverage and
              exclusions.
            </p>
            <div className="protection-expiry">
              <ShieldCheck size={21} />
              <div>
                <small>COVERAGE EXPIRATION</small>
                <strong>
                  {expiry(Number(values.term_months))} {unlimited ? "·" : "or"}{" "}
                  {endMiles(unlimited ? null : Number(values.term_miles))}
                </strong>
              </div>
            </div>
          </fieldset>
        )}
        <fieldset disabled={blocked}>
          <legend>Lienholder · shared by all products</legend>
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
            disabled={blocked}
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
            disabled={blocked}
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I verified the customer, vehicle, selected products, prices and
          benefit limits. Issued terms cannot be edited.
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
            disabled={blocked}
            onClick={() => {
              if (!form.current?.reportValidity()) return;
              const c = inputs();
              if (c) setPreview(draft(c));
            }}
          >
            Preview {linked ? "all contracts" : "contract"}
          </button>
          <button
            className="btn primary"
            disabled={blocked || !reviewed || !confirmed}
          >
            {saving
              ? "Preparing contracts…"
              : linked
                ? `Issue ${products!.length} ${products!.length === 1 ? "contract" : "contracts"} & print`
                : "Issue contract"}
          </button>
        </div>
      </form>
      {preview && (
        <ProtectionPDFPreview
          contracts={preview}
          demo={demo}
          draft
          onClose={() => setPreview(null)}
        />
      )}
    </Modal>
  );
}
