"use client";
import { Plus, Trash2 } from "lucide-react";
import { fullMoney } from "../lib/model";
import {
  protectionDeductibles,
  protectionExpiry,
  protectionPlans,
} from "../lib/protection";
import {
  isMechanicalPlan,
  protectionDescriptions,
  type ProtectionPlan,
} from "../lib/protection-programs";
import {
  newProtectionQuoteItem,
  protectionQuoteCost,
  protectionQuoteTotals,
  type ProtectionQuoteItem,
} from "../lib/protection-quote";
import type { ProductPricing } from "../lib/protection-pricing";
import { ProtectionCostSummary } from "./ProtectionCostSummary";
import { ProtectionTermChoices } from "./ProtectionTermChoices";

export function ProtectionQuoteProducts({
  items,
  onChange,
  pricing,
  disabled,
  issuedOn,
  startMiles,
}: {
  items: ProtectionQuoteItem[];
  onChange: (items: ProtectionQuoteItem[]) => void;
  pricing?: ProductPricing;
  disabled: boolean;
  issuedOn: string;
  startMiles: string;
}) {
  const update = (id: string, patch: Partial<ProtectionQuoteItem>) =>
    onChange(items.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const totals = protectionQuoteTotals(items, pricing);
  const money = (n: number | null) => (n === null ? "—" : fullMoney(n));
  return (
    <div className="protection-quote-products">
      <p className="ops-help">
        Choose products and enter customer prices to build a quote. Add customer
        and vehicle details below when ready to issue.
      </p>
      {!pricing?.active && (
        <p className="pricing-status" role="status">
          The automatic cost schedule is inactive. Customer prices can still be
          quoted; internal cost and profit are unavailable until pricing is
          activated in Settings.
        </p>
      )}
      {items.map((p, index) => {
        const mechanical = isMechanicalPlan(p.plan);
        const allocation = protectionQuoteCost(p, pricing);
        const numberField = (
          key:
            | "price"
            | "term_months"
            | "term_miles"
            | "claim_limit"
            | "maintenance_visits",
          label: string,
          required = true,
        ) => (
          <label>
            {label}
            <input
              type="number"
              value={p[key]}
              required={required}
              readOnly={p.plan === "appearance" && key === "term_months"}
              min={key === "price" || key === "claim_limit" ? "0.01" : "1"}
              max={
                key === "term_months"
                  ? 120
                  : key === "maintenance_visits"
                    ? 100
                    : key === "term_miles"
                      ? 3000000
                      : 1000000
              }
              step={key === "price" || key === "claim_limit" ? "0.01" : "1"}
              placeholder={
                key === "claim_limit" ? "Required to issue" : undefined
              }
              onChange={(e) => update(p.id, { [key]: e.target.value })}
            />
          </label>
        );
        let expiry = "";
        try {
          if (
            /^\d{4}-\d{2}-\d{2}$/.test(issuedOn) &&
            Number(p.term_months) > 0 &&
            Number(p.term_months) <= 120
          )
            expiry = protectionExpiry(issuedOn, Number(p.term_months));
        } catch {
          /* Incomplete date while editing. */
        }
        return (
          <fieldset key={p.id} disabled={disabled}>
            <legend>
              {index + 1}. {protectionPlans[p.plan]}
            </legend>
            <div className="protection-quote-row-head">
              <span>Coverage and customer price</span>
              <button
                type="button"
                className="text-btn"
                aria-label={`Remove product ${index + 1}`}
                disabled={items.length === 1}
                onClick={() => onChange(items.filter((x) => x.id !== p.id))}
              >
                <Trash2 size={15} /> Remove
              </button>
            </div>
            {mechanical && (
              <ProtectionTermChoices
                months={Number(p.term_months)}
                miles={Number(p.term_miles)}
                annualMiles={pricing?.active?.annual_miles}
                disabled={disabled}
                onChange={(months, miles) =>
                  update(p.id, {
                    term_months: String(months),
                    term_miles: String(miles),
                  })
                }
              />
            )}
            <div className="ops-form-grid">
              <label>
                Coverage plan
                <select
                  value={p.plan}
                  onChange={(e) => {
                    const plan = e.target.value as ProtectionPlan;
                    const defaults = newProtectionQuoteItem(
                      p.id,
                      plan,
                      pricing?.active?.annual_miles,
                    );
                    update(p.id, {
                      ...defaults,
                      price: p.price,
                      term_months:
                        plan === "appearance"
                          ? "96"
                          : p.plan === "appearance"
                            ? "12"
                            : p.term_months,
                      term_miles: p.term_miles,
                      deductible:
                        isMechanicalPlan(plan) && mechanical
                          ? p.deductible
                          : "0",
                      claim_limit:
                        isMechanicalPlan(plan) && mechanical
                          ? p.claim_limit
                          : "",
                    });
                  }}
                >
                  {Object.entries(protectionPlans).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {numberField("price", "Customer price")}
              {numberField("term_months", "Term (months)")}
              {!mechanical && (
                <label>
                  Coverage mileage
                  <select
                    disabled={p.plan === "appearance"}
                    value={String(p.unlimited_miles)}
                    onChange={(e) =>
                      update(p.id, {
                        unlimited_miles: e.target.value === "true",
                      })
                    }
                  >
                    <option value="false">Additional mile allowance</option>
                    <option value="true">Unlimited mileage</option>
                  </select>
                </label>
              )}
              {!p.unlimited_miles &&
                numberField("term_miles", "Additional covered miles")}
              {mechanical ? (
                <>
                  <label>
                    Deductible per repair visit
                    <select
                      value={p.deductible}
                      onChange={(e) =>
                        update(p.id, { deductible: e.target.value })
                      }
                    >
                      {protectionDeductibles.map((d) => (
                        <option key={d} value={d}>
                          {fullMoney(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {numberField("claim_limit", "Aggregate repair benefit limit")}
                </>
              ) : (
                <label>
                  Deductible
                  <input value="$0" readOnly />
                </label>
              )}
              {p.plan === "maintenance" &&
                numberField(
                  "maintenance_visits",
                  "Included maintenance visits",
                )}
            </div>
            {allocation ? (
              <ProtectionCostSummary
                snapshot={allocation}
                price={Number(p.price)}
              />
            ) : pricing?.active ? (
              <p className="ops-help">
                Enter a customer price and complete this product’s coverage to
                see its cost and profit.
              </p>
            ) : null}
            <p className="ops-help">
              {protectionDescriptions[p.plan]} See the agreement for coverage
              and exclusions.
            </p>
            {expiry && (
              <p className="protection-product-expiry">
                Expires {expiry}
                {p.unlimited_miles
                  ? " · Unlimited mileage"
                  : startMiles?.trim() && Number(p.term_miles) > 0
                    ? ` or ${(Number(startMiles) + Number(p.term_miles)).toLocaleString()} miles, whichever comes first.`
                    : " · Enter the starting odometer below to see expiration miles."}
              </p>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        className="btn"
        disabled={disabled || items.length >= 30}
        onClick={() => {
          const plan =
            (Object.keys(protectionPlans) as ProtectionPlan[]).find(
              (plan) =>
                !items.some((p) => p.plan === plan) &&
                !(
                  isMechanicalPlan(plan) &&
                  items.some((p) => isMechanicalPlan(p.plan))
                ),
            ) ?? "deluxe";
          onChange([
            ...items,
            newProtectionQuoteItem(
              crypto.randomUUID(),
              plan,
              pricing?.active?.annual_miles,
            ),
          ]);
        }}
      >
        <Plus size={16} /> Add product
      </button>
      <div className="protection-quote-totals" aria-live="polite">
        <div>
          <small>
            Customer total · {items.length}{" "}
            {items.length === 1 ? "product" : "products"}
          </small>
          <strong>{money(totals.price)}</strong>
        </div>
        <div>
          <small>Total claims fund allocation</small>
          <strong>{money(totals.cost)}</strong>
        </div>
        <div>
          <small>Total product gross</small>
          <strong>{money(totals.gross)}</strong>
        </div>
      </div>
      <p className="ops-help">
        Costs, fund allocations and profit stay internal. Only coverage and
        customer prices appear on the printed quote and contracts.
      </p>
    </div>
  );
}
