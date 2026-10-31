"use client";
import { useRef, useState } from "react";
import { Settings2, ShieldCheck } from "lucide-react";
import {
  canManage,
  fullMoney,
  type Workspace,
  type Command,
} from "../lib/model";
import {
  proposedPricing,
  pricingConfigSchema,
  protectionCost,
  type PricingConfig,
} from "../lib/protection-pricing";
import { protectionPlans, protectionDeductibles } from "../lib/protection";
import { ProtectionCostSummary } from "./ProtectionCostSummary";
import {
  protectionPlanIds,
  isMechanicalPlan,
  type ProtectionPlan,
} from "../lib/protection-programs";
import type { ManagementRun } from "./ServiceWorkspace";
import { SectionTitle } from "./ui";

export function ProductPricingSettings(props: {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
}) {
  if (!canManage(props.ws.member.role)) return null;
  return (
    <PricingEditor
      key={props.ws.product_pricing?.[0]?.revision ?? 0}
      {...props}
    />
  );
}
function PricingEditor({
  ws,
  run,
  busy,
}: {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
}) {
  const saved = ws.product_pricing?.[0];
  const [draft, setDraft] = useState<PricingConfig>(() =>
    structuredClone(saved?.draft ?? proposedPricing),
  );
  const [approved, setApproved] = useState(false),
    [error, setError] = useState("");
  const [examplePlan, setExamplePlan] = useState<ProtectionPlan>("deluxe");
  const [months, setMonths] = useState(36),
    [miles, setMiles] = useState(36000),
    [visits, setVisits] = useState(6),
    [price, setPrice] = useState(2499);
  const [deductible, setDeductible] = useState(0);
  const request = useRef({ payload: "", id: "" });
  const changed =
    !saved || JSON.stringify(draft) !== JSON.stringify(saved.draft);
  const valid = pricingConfigSchema.safeParse(draft);
  const example = valid.success
    ? protectionCost(
        {
          protection_plan: examplePlan,
          term_months: examplePlan === "appearance" ? 96 : months,
          mileage_limit: miles,
          unlimited_miles: examplePlan === "appearance",
          maintenance_visits: visits,
          deductible: isMechanicalPlan(examplePlan) ? deductible : 0,
          price,
        },
        valid.data,
        (saved?.revision ?? 0) + 1,
      )
    : null;
  async function submit(
    input: Omit<
      Extract<
        Command,
        {
          type:
            | "save_product_pricing"
            | "activate_product_pricing"
            | "pause_product_pricing";
        }
      >,
      "request_id"
    > & { config?: PricingConfig; approved?: true },
  ) {
    setError("");
    const payload = JSON.stringify(input);
    if (request.current.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    const result = await run(
      { ...input, request_id: request.current.id } as Command,
      input.type === "save_product_pricing"
        ? "Draft pricing saved; active rates unchanged"
        : input.type === "activate_product_pricing"
          ? "Product pricing activated for new proposals"
          : "Automatic product pricing paused",
    );
    if (!result.ok) setError(result.error ?? "Unable to save pricing.");
  }
  function change(next: PricingConfig) {
    setDraft(next);
    setApproved(false);
  }
  return (
    <section className="panel pricing-settings">
      <SectionTitle
        title="Protection product pricing"
        subtitle="Internal costs, deal contribution and claims funding."
        action={<Settings2 size={20} />}
      />
      <div className={`pricing-status ${saved?.active ? "active" : ""}`}>
        <ShieldCheck size={19} />
        <div>
          <strong>
            {saved?.active
              ? `Active schedule · revision ${saved.active_revision}`
              : "Draft only — automatic pricing is inactive"}
          </strong>
          <p>
            {saved?.active
              ? "Saving a draft keeps the current schedule in use until the owner activates the changes."
              : "Review and save the proposed schedule, then activate it after approval. Existing product costs remain unchanged."}
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid.success) {
            setError(valid.error.issues[0].message);
            return;
          }
          void submit({
            type: "save_product_pricing",
            revision: saved?.revision ?? 0,
            config: valid.data,
          });
        }}
      >
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Drive Max product</th>
                <th>Draft cost</th>
                <th>Calculation</th>
                {saved?.active && <th>Active rate</th>}
              </tr>
            </thead>
            <tbody>
              {protectionPlanIds.map((plan) => (
                <tr key={plan}>
                  <th scope="row">{protectionPlans[plan]}</th>
                  <td>
                    <input
                      aria-label={`${protectionPlans[plan]} draft cost`}
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      required
                      value={draft.rates[plan].amount}
                      onChange={(e) =>
                        change({
                          ...draft,
                          rates: {
                            ...draft.rates,
                            [plan]: {
                              ...draft.rates[plan],
                              amount: Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                  </td>
                  <td>
                    {plan === "maintenance" ? (
                      "Per included visit"
                    ) : plan === "appearance" ? (
                      "Flat · 8 years / unlimited miles"
                    ) : (
                      <select
                        aria-label={`${protectionPlans[plan]} calculation`}
                        value={draft.rates[plan].basis}
                        onChange={(e) =>
                          change({
                            ...draft,
                            rates: {
                              ...draft.rates,
                              [plan]: {
                                ...draft.rates[plan],
                                basis: e.target.value as
                                  "annual" | "annual_mileage" | "first_limit",
                              },
                            },
                          })
                        }
                      >
                        {isMechanicalPlan(plan) && (
                          <option value="first_limit">
                            Time or mileage · whichever ends first
                          </option>
                        )}
                        <option value="annual">
                          Per year · prorated months
                        </option>
                        <option value="annual_mileage">
                          Greater of years or mileage units (legacy)
                        </option>
                      </select>
                    )}
                  </td>
                  {saved?.active && (
                    <td>
                      {fullMoney(saved.active.rates[plan].amount)} /{" "}
                      {
                        {
                          annual: "year",
                          annual_mileage: "year or mileage unit (higher)",
                          first_limit: "year or mileage unit (lower)",
                          visit: "visit",
                          flat: "contract",
                        }[saved.active.rates[plan].basis]
                      }
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <fieldset className="pricing-discounts">
          <legend>Service contract deductible discounts</legend>
          <p className="ops-help">
            Percentage off the prorated $0-deductible cost, for Deluxe and
            Platinum. A higher deductible should have the same or a larger
            discount.
          </p>
          <div className="pricing-fields">
            {protectionDeductibles.map((d) => (
              <label key={d}>
                {fullMoney(d)} deductible · discount (%)
                <input
                  type="number"
                  min="0"
                  max="95"
                  step="0.01"
                  required
                  readOnly={d === 0}
                  value={draft.deductible_discounts?.[d] ?? 0}
                  onChange={(e) =>
                    change({
                      ...draft,
                      deductible_discounts: {
                        "0": 0,
                        "250": 0,
                        "500": 0,
                        "1000": 0,
                        ...draft.deductible_discounts,
                        [d]: Number(e.target.value),
                      },
                    })
                  }
                />
                {saved?.active && (
                  <small>
                    Active: {saved.active.deductible_discounts?.[d] ?? 0}%
                  </small>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="pricing-fields">
          <label>
            Miles per annual cost unit
            <input
              type="number"
              min="1000"
              max="100000"
              step="1"
              required
              value={draft.annual_miles}
              onChange={(e) =>
                change({ ...draft, annual_miles: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Maintenance interval (miles)
            <input
              type="number"
              min="1000"
              max="20000"
              step="1"
              required
              value={draft.maintenance_interval}
              onChange={(e) =>
                change({
                  ...draft,
                  maintenance_interval: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Funding floor (% of selling price)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={draft.reserve_percent}
              onChange={(e) =>
                change({ ...draft, reserve_percent: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Claims account name
            <input
              maxLength={100}
              required
              value={draft.account_name}
              onChange={(e) =>
                change({ ...draft, account_name: e.target.value })
              }
            />
          </label>
        </div>
        <p className="ops-help">
          Time or mileage pricing uses the lower of months ÷ 12 and covered
          miles ÷ annual miles, then applies the deductible discount. The
          funding minimum is calculated separately; use 0% if you want only the
          calculated cost set aside.
        </p>
        <p className="ops-help">
          Claims fund allocation is the higher of calculated cost or the funding
          minimum. Product gross is selling price minus that allocation.
          Maintenance cost uses the selected visit count. Customer menus and
          contracts show only selling prices and coverage.
        </p>
        <button className="btn primary" disabled={busy || !changed}>
          Save draft schedule
        </button>
      </form>
      <details className="pricing-preview" open>
        <summary>Try the draft schedule</summary>
        <div className="pricing-fields">
          <label>
            Preview product
            <select
              value={examplePlan}
              onChange={(e) => setExamplePlan(e.target.value as ProtectionPlan)}
            >
              {protectionPlanIds.map((p) => (
                <option key={p} value={p}>
                  {protectionPlans[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Months
            <input
              type="number"
              min="1"
              max="120"
              value={examplePlan === "appearance" ? 96 : months}
              disabled={examplePlan === "appearance"}
              onChange={(e) => setMonths(Number(e.target.value))}
            />
          </label>
          <label>
            Covered miles
            <input
              type="number"
              min="0"
              max="3000000"
              value={miles}
              disabled={examplePlan === "appearance"}
              onChange={(e) => setMiles(Number(e.target.value))}
            />
          </label>
          {examplePlan === "maintenance" && (
            <label>
              Included visits
              <input
                type="number"
                min="1"
                max="100"
                value={visits}
                onChange={(e) => setVisits(Number(e.target.value))}
              />
            </label>
          )}
          {isMechanicalPlan(examplePlan) && (
            <label>
              Preview deductible
              <select
                value={deductible}
                onChange={(e) => setDeductible(Number(e.target.value))}
              >
                {protectionDeductibles.map((d) => (
                  <option key={d} value={d}>
                    {fullMoney(d)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Customer selling price
            <input
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </label>
        </div>
        {example && <ProtectionCostSummary snapshot={example} price={price} />}
      </details>
      {ws.member.role === "owner" && (
        <div className="pricing-activation">
          <label className="protection-check">
            <input
              type="checkbox"
              checked={approved}
              disabled={changed || !saved || busy}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve the saved draft rates and funding policy for new proposals
            and contracts.
          </label>
          <div className="ops-actions">
            <button
              className="btn primary"
              disabled={busy || changed || !approved || !saved}
              onClick={() =>
                void submit({
                  type: "activate_product_pricing",
                  revision: saved!.revision,
                  approved: true,
                })
              }
            >
              Activate saved schedule
            </button>
            {saved?.active && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void submit({
                    type: "pause_product_pricing",
                    revision: saved.revision,
                  })
                }
              >
                Pause automatic pricing
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="ops-help">
        Schedule changes apply to new or edited proposals. Issued contracts and
        closed deals keep their saved costs. Transfers are recorded separately
        in Accounting.
      </p>
      {!!ws.pricing_events?.length && (
        <details>
          <summary>Pricing and fund activity</summary>
          <ul>
            {ws.pricing_events.slice(0, 12).map((e) => (
              <li key={e.id}>
                {new Date(e.created_at).toLocaleString()} ·{" "}
                {String(e.command.type).replaceAll("_", " ")} ·{" "}
                {ws.staff.find((s) => s.user_id === e.created_by)?.name ??
                  "Team member"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
