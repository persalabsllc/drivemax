"use client";
import { useState } from "react";
import {
  Printer,
  Car,
  ArrowLeftRight,
  Save,
  Mail,
  MessageSquare,
} from "lucide-react";
import { deskingDefaults, deskingPaymentOptions } from "../lib/desking";
import {
  type Customer,
  type Opportunity,
  type Quote,
  type QuoteValues,
  type Command,
  quoteMath,
  dayKey,
  fullMoney,
  opportunityOpen,
} from "../lib/model";
import { financePayment } from "../lib/finance";
import { type InventoryVehicle, vehicleName } from "../lib/vehicles";
import { VehicleFacts } from "./VehicleFields";
import { FIProducts } from "./FIProducts";
import { productsTotal } from "../lib/operations";
export function Desking({
  customer,
  opportunity,
  inventory,
  quotes,
  busy,
  onSave,
  onPrint,
  onShare,
  onEdit,
}: {
  customer: Customer;
  opportunity: Opportunity;
  inventory: InventoryVehicle[];
  quotes: Quote[];
  busy: boolean;
  onSave: (
    c: Extract<Command, { type: "save_quote" }>,
  ) => Promise<{ ok: boolean }>;
  onPrint: (q: Quote) => void;
  onShare?: (q: Quote, channel: "email" | "sms") => void;
  onEdit: () => void;
}) {
  const [productsOpen, setProductsOpen] = useState(false);
  const saved = quotes
      .filter((q) => q.opportunity_id === opportunity.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    readOnly = !opportunityOpen(opportunity),
    latest = readOnly
      ? (opportunity.sale_snapshot?.quote ?? undefined)
      : saved.find(
          (q) =>
            (q.inventory_id ?? null) === opportunity.inventory_id &&
            (!!opportunity.inventory_id ||
              q.vehicle === opportunity.vehicle_interest),
        );
  const vehicle = readOnly
    ? opportunity.vehicle_details
    : (inventory.find((v) => v.id === opportunity.inventory_id) ??
      opportunity.vehicle_details);
  const [draft, setDraft] = useState<QuoteValues>(() => {
    const b = deskingDefaults(customer, readOnly ? [] : inventory, latest);
    const options = deskingPaymentOptions(b);
    return {
      ...b,
      mode: b.mode ?? "finance",
      taxMode: b.taxMode ?? (latest ? "manual" : "auto"),
      taxReason: b.taxReason ?? (latest ? "Previously saved estimate" : ""),
      addOns: b.addOns ?? 0,
      serviceContract: b.serviceContract ?? 0,
      otherTaxes: b.otherTaxes ?? 0,
      daysToFirstPayment: b.daysToFirstPayment ?? (latest ? 30 : 45),
      financeOptions: options.terms,
      downPayments: options.downs,
      selectedOption: b.selectedOption ?? 2,
      selectedDown: b.selectedDown ?? 0,
    };
  });
  const [description, setDescription] = useState(
    vehicle
      ? vehicleName(vehicle) || opportunity.vehicle_interest
      : opportunity.vehicle_interest,
  );
  const terms = draft.financeOptions!,
    downs = draft.downPayments!,
    selectedRow = draft.selectedOption ?? 2,
    selectedCol = draft.selectedDown ?? 0;
  const values = {
    ...draft,
    apr: draft.mode === "cash" ? 0 : terms[selectedRow].apr,
    months: terms[selectedRow].months,
    downPayment: draft.mode === "cash" ? draft.downPayment : downs[selectedCol],
  };
  const totals = quoteMath(values);
  const field = (
    key: keyof QuoteValues,
    label: string,
    max = 1000000,
    min = 0,
    step = 0.01,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={String(draft[key] ?? 0)}
        required
        readOnly={readOnly}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="profile-body desking">
      {productsOpen && (
        <FIProducts
          products={draft.products}
          legacy={draft.serviceContract ?? 0}
          readOnly={readOnly}
          onClose={() => setProductsOpen(false)}
          onSave={(products) =>
            setDraft({
              ...draft,
              products,
              serviceContract: productsTotal({ ...draft, products }),
            })
          }
        />
      )}
      <div className="desk-section-head">
        <div>
          <span className="eyebrow">
            {readOnly ? "COMPLETED OPPORTUNITY" : "WORK THE DEAL"}
          </span>
          <h3>Desking</h3>
        </div>
        {!readOnly && (
          <button className="btn small" onClick={onEdit}>
            Change vehicle / trade
          </button>
        )}
      </div>
      {vehicle && (
        <div className="desk-stock">
          <div className="desk-stock-title">
            <Car size={19} />
            <div>
              <strong>
                {vehicleName(vehicle) || opportunity.vehicle_interest}
              </strong>
              <span>
                {vehicle.vin || "Manual vehicle"} ·{" "}
                {readOnly
                  ? "Recorded at closing"
                  : opportunity.inventory_id
                    ? "Linked inventory"
                    : "Manual vehicle"}
              </span>
            </div>
          </div>
          <VehicleFacts
            vehicle={vehicle}
            today={
              readOnly
                ? (opportunity.sold_on ?? dayKey(opportunity.closed_at!))
                : dayKey()
            }
            compact
          />
        </div>
      )}
      {readOnly && (
        <p className="history-notice">
          This opportunity is closed. Create a new opportunity for the next
          purchase. Saved proposals and paperwork remain available below.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            type: "save_quote",
            customer_id: customer.id,
            opportunity_id: opportunity.id,
            vehicle: description,
            values: { ...values, tax: totals.tax },
          });
        }}
      >
        <div className="deal-mode" role="group" aria-label="Purchase type">
          {(["cash", "finance"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={draft.mode === mode ? "selected" : ""}
              disabled={readOnly}
              onClick={() => setDraft({ ...draft, mode })}
            >
              {mode === "cash" ? "Cash purchase" : "Finance purchase"}
              <strong>
                {mode === "cash"
                  ? fullMoney(totals.total)
                  : fullMoney(totals.payment) + "/mo"}
              </strong>
            </button>
          ))}
        </div>
        <div className="desking-layout">
          <section className="desk-section">
            <div className="desk-section-head">
              <h3>Sale figures</h3>
              {!readOnly && vehicle?.price != null && (
                <button
                  className="text-btn"
                  type="button"
                  onClick={() => setDraft({ ...draft, price: vehicle.price! })}
                >
                  Use inventory price
                </button>
              )}
            </div>
            <label>
              Vehicle description
              <input value={description} readOnly required maxLength={250} />
            </label>
            <div className="form-grid">
              {field("price", "Selling price")}
              {field("docFee", "Document fee")}
              {field("addOns", "Accessories / taxable add-ons")}
              <div className="ops-product-summary">
                <small>F&I products</small>
                <strong>{fullMoney(productsTotal(draft))}</strong>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setProductsOpen(true)}
                >
                  {readOnly ? "View products" : "Edit product details"}
                </button>
              </div>
              {field("titleFee", "Title / registration fees")}
              {field("otherTaxes", "Other verified taxes")}
            </div>
            <div className="tax-summary">
              <div>
                <span>NC highway-use tax · 3%</span>
                <strong>{fullMoney(totals.tax)}</strong>
              </div>
              <small>
                {fullMoney(totals.taxBase)} taxable base after trade allowance.
                Payoff does not reduce tax.
              </small>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.taxMode === "manual"}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    taxMode: e.target.checked ? "manual" : "auto",
                    tax: totals.tax,
                  })
                }
              />
              Override highway-use tax
            </label>
            {draft.taxMode === "manual" && (
              <div className="form-grid">
                {field("tax", "Verified highway-use tax")}
                <label>
                  Override reason
                  <input
                    required
                    value={draft.taxReason ?? ""}
                    maxLength={500}
                    readOnly={readOnly}
                    onChange={(e) =>
                      setDraft({ ...draft, taxReason: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
            <p className="fine-print">
              Automatic calculation is for a standard NC retail vehicle sale.
              Separately stated service contracts are excluded from highway-use
              tax; enter any applicable other taxes separately.
            </p>
            <h3 className="desk-trade-heading">
              <ArrowLeftRight size={17} />
              Trade-in
            </h3>
            <p className="fine-print">
              {customer.trade?.description ||
                customer.trade_vehicle ||
                "No trade-in"}
              {customer.trade &&
                ` · ${customer.trade.vin} · ${customer.trade.mileage.toLocaleString()} miles`}
            </p>
            <div className="form-grid">
              {field("tradeAllowance", "Trade allowance")}
              {field("payoff", "Trade payoff")}
              {field("acv", "ACV · internal")}
              {field("recon", "Trade recon · internal")}
            </div>
          </section>
          <section className="desk-payment">
            <span className="eyebrow">PAYMENT OPTIONS</span>
            <h3>
              {draft.mode === "cash"
                ? "Cash purchase summary"
                : "Compare terms and down payments"}
            </h3>
            {draft.mode === "finance" ? (
              <>
                <div className="form-grid">
                  {field(
                    "daysToFirstPayment",
                    "Days to first payment",
                    120,
                    30,
                    1,
                  )}
                  <div className="first-payment-note">
                    <strong>{values.daysToFirstPayment} days</strong>
                    <small>
                      {Math.max(0, (values.daysToFirstPayment ?? 45) - 30)}{" "}
                      extra days beyond a standard 30-day first period.
                    </small>
                  </div>
                </div>
                <div className="payment-table-scroll">
                  <table className="payment-matrix">
                    <thead>
                      <tr>
                        <th>Term / APR</th>
                        {downs.map((d, i) => (
                          <th key={i}>
                            <label>
                              Down payment {i + 1}
                              <input
                                aria-label={`Down payment option ${i + 1}`}
                                type="number"
                                min={0}
                                max={1000000}
                                step=".01"
                                value={d}
                                readOnly={readOnly}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    downPayments: downs.map((x, j) =>
                                      i === j ? Number(e.target.value) : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t, i) => (
                        <tr key={i}>
                          <th>
                            <label>
                              Months
                              <input
                                aria-label={`Term ${i + 1} months`}
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={t.months}
                                readOnly={readOnly}
                                required
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    financeOptions: terms.map((x, j) =>
                                      i === j
                                        ? {
                                            ...x,
                                            months: Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label>
                              APR %
                              <input
                                aria-label={`Term ${i + 1} APR`}
                                type="number"
                                min={0}
                                max={50}
                                step=".01"
                                value={t.apr}
                                readOnly={readOnly}
                                required
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    financeOptions: terms.map((x, j) =>
                                      i === j
                                        ? { ...x, apr: Number(e.target.value) }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </th>
                          {downs.map((down, j) => {
                            const p = financePayment(
                              totals.total - down,
                              t.apr,
                              t.months,
                              draft.daysToFirstPayment,
                            );
                            return (
                              <td key={j}>
                                <button
                                  type="button"
                                  aria-label={`${t.months} months at ${t.apr}% with ${fullMoney(down)} down: ${fullMoney(p.payment)} monthly`}
                                  aria-pressed={
                                    i === selectedRow && j === selectedCol
                                  }
                                  className={
                                    i === selectedRow && j === selectedCol
                                      ? "selected"
                                      : ""
                                  }
                                  disabled={readOnly}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      selectedOption: i,
                                      selectedDown: j,
                                    })
                                  }
                                >
                                  <strong>{fullMoney(p.payment)}</strong>
                                  <small>per month</small>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="selected-payment">
                  <span>Selected estimate</span>
                  <strong>
                    {fullMoney(totals.payment)}
                    <small>/ month</small>
                  </strong>
                  <p>
                    {values.months} months · {values.apr}% APR ·{" "}
                    {fullMoney(values.downPayment)} down
                  </p>
                  <dl>
                    <dt>Amount financed before odd-days interest</dt>
                    <dd>{fullMoney(totals.balance)}</dd>
                    <dt>Additional first-period interest</dt>
                    <dd>{fullMoney(totals.firstPeriodInterest)}</dd>
                  </dl>
                </div>
                <p className="fine-print">
                  Estimate uses simple interest at APR ÷ 365 for days beyond 30,
                  then monthly amortization. Actual lender calculations and
                  approval may differ. The additional interest is included in
                  this displayed estimate.
                </p>
              </>
            ) : (
              <>
                {field("downPayment", "Deposit / amount already paid")}
                <div className="selected-payment">
                  <span>Remaining cash balance</span>
                  <strong>{fullMoney(totals.balance)}</strong>
                  <p>Total after trade and payoff: {fullMoney(totals.total)}</p>
                </div>
              </>
            )}
            {!readOnly && (
              <button className="btn primary desk-save" disabled={busy}>
                <Save size={16} />
                Save desking version
              </button>
            )}
          </section>
        </div>
      </form>
      <div className="section-heading">
        <div>
          <h2>Saved proposals</h2>
          <p>Each version keeps its own vehicle, trade, and figures.</p>
        </div>
      </div>
      {saved.map((q) => (
        <div className="saved-quote" key={q.id}>
          <div>
            <strong>{q.vehicle}</strong>
            <span>
              {new Date(q.created_at).toLocaleString("en-US", {
                timeZone: "America/New_York",
              })}{" "}
              · {fullMoney(quoteMath(q.values).balance)} balance
            </span>
          </div>
          {onShare && (
            <div className="ops-actions">
              <button className="btn small" onClick={() => onShare(q, "email")}>
                <Mail size={14} />
                Email quote
              </button>
              <button className="btn small" onClick={() => onShare(q, "sms")}>
                <MessageSquare size={14} />
                Text quote
              </button>
            </div>
          )}
          <button className="btn small" onClick={() => onPrint(q)}>
            <Printer size={14} />
            Print quote
          </button>
        </div>
      ))}
    </div>
  );
}
