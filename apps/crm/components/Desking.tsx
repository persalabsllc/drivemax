"use client";
import { useState } from "react";
import { deskingDefaults } from "../lib/desking";
import {
  FileText,
  Printer,
  Car,
  ArrowLeftRight,
  RefreshCw,
} from "lucide-react";
import {
  type Customer,
  type Quote,
  type QuoteValues,
  type Command,
  defaultQuote,
  quoteMath,
  dayKey,
  fullMoney,
  money,
} from "../lib/model";
import { type InventoryVehicle, vehicleName } from "../lib/vehicles";
import { VehicleFacts } from "./VehicleFields";
import { SectionTitle } from "./ui";
export function Desking({
  customer,
  inventory,
  quotes,
  busy,
  onSave,
  onPrint,
  onEdit,
}: {
  customer: Customer;
  inventory: InventoryVehicle[];
  quotes: Quote[];
  busy: boolean;
  onSave: (
    c: Extract<Command, { type: "save_quote" }>,
  ) => Promise<{ ok: boolean }>;
  onPrint: (q: Quote) => void;
  onEdit: () => void;
}) {
  const saved = quotes
      .filter((q) => q.customer_id === customer.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    latest = saved[0];
  const vehicle =
    inventory.find((v) => v.id === customer.inventory_id) ??
    customer.vehicle_details;
  const [draft, setDraft] = useState(() =>
      deskingDefaults(customer, inventory, latest),
    ),
    [description, setDescription] = useState(
      vehicle
        ? vehicleName(vehicle) || customer.vehicle_interest
        : customer.vehicle_interest,
    );
  const fields = (keys: [keyof QuoteValues, string][]) =>
    keys.map(([key, label]) => (
      <label key={key}>
        {label}
        <input
          type="number"
          min={key === "months" ? 1 : 0}
          max={key === "months" ? 120 : key === "apr" ? 50 : 1000000}
          step={key === "months" ? 1 : 0.01}
          value={draft[key]}
          onChange={(e) =>
            setDraft({ ...draft, [key]: Number(e.target.value) })
          }
          required
        />
      </label>
    ));
  const totals = quoteMath(draft);
  return (
    <div className="profile-body desking">
      <div className="desk-section-head">
        <div>
          <span className="eyebrow">WORK THE DEAL</span>
          <h3>Desking worksheet</h3>
        </div>
        <button className="btn small" onClick={onEdit}>
          Change vehicle / trade
        </button>
      </div>
      {vehicle && (
        <div className="desk-stock">
          <div className="desk-stock-title">
            <Car size={19} />
            <div>
              <strong>
                {vehicleName(vehicle) || customer.vehicle_interest}
              </strong>
              <span>
                {vehicle.vin || "Manual vehicle"}
                {customer.inventory_id ? " · Linked inventory" : ""}
              </span>
            </div>
          </div>
          <VehicleFacts vehicle={vehicle} today={dayKey()} compact />
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            type: "save_quote",
            customer_id: customer.id,
            vehicle: description,
            values: draft,
          });
        }}
      >
        <section className="desk-section">
          <div className="desk-section-head">
            <h3>Vehicle & fees</h3>
            {vehicle?.price != null && (
              <button
                type="button"
                className="text-btn"
                onClick={() => setDraft({ ...draft, price: vehicle.price! })}
              >
                <RefreshCw size={13} />
                {customer.inventory_id
                  ? "Use inventory price"
                  : "Use vehicle price"}
              </button>
            )}
          </div>
          <label>
            Vehicle description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={250}
            />
          </label>
          <div className="quote-fields">
            {fields([
              ["price", "Selling price"],
              ["docFee", "Document fee"],
              ["tax", "Verified tax amount"],
              ["titleFee", "Title / registration fees"],
            ])}
          </div>
        </section>
        <section className="desk-section">
          <div className="desk-section-head">
            <h3>
              <ArrowLeftRight size={17} />
              Trade-in
            </h3>
            {!customer.trade && !customer.trade_vehicle && (
              <span className="fine-print">No trade selected</span>
            )}
          </div>
          {customer.trade && (
            <div className="desk-trade-description">
              <strong>
                {customer.trade.description || vehicleName(customer.trade)}
              </strong>
              <span>
                {customer.trade.vin} · {customer.trade.mileage.toLocaleString()}{" "}
                miles
              </span>
            </div>
          )}
          {!customer.trade && customer.trade_vehicle && (
            <p className="fine-print">
              {customer.trade_vehicle} · Complete VIN, mileage, and trade values
              in Edit profile.
            </p>
          )}
          <div className="quote-fields">
            {fields([
              ["tradeAllowance", "Trade allowance"],
              ["payoff", "Trade payoff"],
              ["acv", "ACV · internal"],
            ])}
          </div>
        </section>
        <section className="desk-section">
          <h3>Payment structure</h3>
          <div className="quote-fields">
            {fields([
              ["downPayment", "Cash down"],
              ["apr", "Illustrative APR %"],
              ["months", "Term (months)"],
            ])}
          </div>
        </section>
        <div className="quote-estimate">
          <div>
            <span>Estimated balance</span>
            <strong>{fullMoney(totals.balance)}</strong>
          </div>
          <div>
            <span>Illustrative monthly payment</span>
            <strong>{fullMoney(totals.payment)}</strong>
          </div>
        </div>
        <p className="fine-print">
          Preliminary estimate, subject to lender approval and verified
          taxes/fees. This is not a financing commitment.
        </p>
        <details className="trade-details">
          <summary>Internal appraisal & deal figures</summary>
          <div className="quote-fields">
            {fields([["recon", "Estimated trade reconditioning"]])}
          </div>
          <div className="internal-metrics">
            <span>
              Trade equity{" "}
              <strong>{money(draft.tradeAllowance - draft.payoff)}</strong>
            </span>
            <span>
              Trade over / under allowance{" "}
              <strong>{money(draft.tradeAllowance - draft.acv)}</strong>
            </span>
          </div>
          <p className="fine-print">
            Vehicle cost, ACV, and internal appraisal figures are excluded from
            customer printouts.
          </p>
        </details>
        <button className="btn primary" disabled={busy}>
          <FileText size={16} />
          {busy ? "Saving…" : "Save desking version"}
        </button>
      </form>
      <SectionTitle
        title="Saved proposals"
        subtitle="Each version keeps the vehicle, trade, and figures as they were when saved."
      />
      {saved.map((q) => (
        <div className="saved-quote" key={q.id}>
          <div>
            <strong>{q.vehicle}</strong>
            <span>
              {new Date(q.created_at).toLocaleString("en-US", {
                timeZone: "America/New_York",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · {money(quoteMath(q.values).balance)} balance
            </span>
          </div>
          <button className="btn small" onClick={() => onPrint(q)}>
            <Printer size={14} />
            Print quote
          </button>
        </div>
      ))}
    </div>
  );
}
