"use client";
import { useState } from "react";
import { Car, ArrowLeftRight } from "lucide-react";
import {
  type Opportunity,
  type Staff,
  type Command,
  dayKey,
  opportunitySchema,
  money,
} from "../lib/model";
import {
  type InventoryVehicle,
  vehicleName,
  inventorySnapshot,
  tradeSchema,
} from "../lib/vehicles";
import {
  VinField,
  VehicleIdentity,
  VehicleFacts,
  vehicleDraft,
  vehicleValues,
  applyDecoded,
} from "./VehicleFields";
export function OpportunityForm({
  existing,
  staff,
  defaultAssignee,
  manager,
  inventory,
  busy,
  error,
  demo,
  submit,
  section = "all",
  showCosts = true,
}: {
  existing: Opportunity | null;
  staff: Staff[];
  defaultAssignee: string | null;
  manager: boolean;
  showCosts?: boolean;
  inventory: InventoryVehicle[];
  busy: boolean;
  error: string;
  demo: boolean;
  section?: "all" | "vehicle" | "trade";
  submit: (
    data: Extract<Command, { type: "create_opportunity" }>["opportunity"],
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState(
      existing?.inventory_id
        ? "inventory"
        : existing?.vehicle_interest
          ? "manual"
          : "inventory",
    ),
    [inventoryId, setInventoryId] = useState(existing?.inventory_id ?? ""),
    [manual, setManual] = useState(() =>
      vehicleDraft(existing?.vehicle_details),
    ),
    [description, setDescription] = useState(existing?.vehicle_interest ?? ""),
    [hasTrade, setHasTrade] = useState(
      !!(existing?.trade || existing?.trade_vehicle),
    ),
    [trade, setTrade] = useState(() => vehicleDraft(existing?.trade)),
    [tradeDescription, setTradeDescription] = useState(
      existing?.trade?.description || existing?.trade_vehicle || "",
    ),
    [values, setValues] = useState({
      allowance: String(existing?.trade?.allowance ?? ""),
      acv: String(existing?.trade?.acv ?? ""),
      payoff: String(existing?.trade?.payoff ?? ""),
    }),
    [localError, setLocalError] = useState("");
  const selected = inventory.find((v) => v.id === inventoryId),
    available = inventory.filter(
      (v) => v.status === "in_stock" || v.id === existing?.inventory_id,
    );
  return (
    <form
      className="modal-form customer-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError("");
        const f = new FormData(e.currentTarget);
        if (section !== "all" && !existing) return;
        let structuredTrade = section === "vehicle" ? existing!.trade : null;
        if (section !== "vehicle" && hasTrade) {
          const t = tradeSchema.safeParse({
            vin: trade.vin,
            mileage: trade.mileage === "" ? null : Number(trade.mileage),
            year: trade.year ? Number(trade.year) : null,
            make: trade.make,
            model: trade.model,
            trim: trade.trim,
            description: tradeDescription || vehicleName(vehicleValues(trade)),
            ...Object.fromEntries(
              Object.entries(values).map(([k, v]) => [
                k,
                !showCosts && k === "acv"
                  ? 0
                  : v === ""
                    ? section === "trade"
                      ? 0
                      : null
                    : Number(v),
              ]),
            ),
          });
          if (!t.success) {
            setLocalError(
              section === "trade"
                ? "Enter a valid trade VIN and mileage. Check any working figures you entered."
                : "Complete the trade VIN, mileage, allowance, ACV, and payoff. Enter 0 where appropriate.",
            );
            return;
          }
          structuredTrade = t.data;
        }
        const data = {
          ...(section === "all"
            ? {
                assigned_to: manager
                  ? String(f.get("assigned_to") || "") || null
                  : existing
                    ? (existing.assigned_to ?? null)
                    : defaultAssignee,
              }
            : {}),
          title: section === "all" ? String(f.get("name")) : existing!.title,
          source:
            section === "all" ? String(f.get("source")) : existing!.source,
          status: (section === "all"
            ? String(f.get("status") || "new")
            : existing!.status) as "new" | "working" | "appointment",
          inventory_id:
            section === "trade"
              ? existing!.inventory_id
              : mode === "inventory"
                ? (selected?.id ?? null)
                : null,
          vehicle_details:
            section === "trade"
              ? existing!.vehicle_details
              : mode === "inventory"
                ? selected
                  ? inventorySnapshot(selected)
                  : null
                : mode === "manual"
                  ? vehicleValues(manual)
                  : null,
          vehicle_interest:
            section === "trade"
              ? existing!.vehicle_interest
              : mode === "inventory"
                ? selected
                  ? vehicleName(selected)
                  : ""
                : mode === "manual"
                  ? description || vehicleName(vehicleValues(manual))
                  : "",
          trade: structuredTrade,
          trade_vehicle:
            section === "vehicle"
              ? existing!.trade_vehicle
              : structuredTrade
                ? structuredTrade.description ||
                  vehicleName(structuredTrade) ||
                  structuredTrade.vin
                : "",
        };
        const checked = opportunitySchema.safeParse(data);
        if (!checked.success) {
          setLocalError(checked.error.issues[0].message);
          return;
        }
        await submit(checked.data);
      }}
    >
      {section === "all" && (
        <>
          <label>
            Opportunity name
            <input
              name="name"
              defaultValue={existing?.title ?? "Vehicle purchase"}
              placeholder="Vehicle purchase"
              required
              minLength={2}
              maxLength={250}
              autoFocus
            />
          </label>
          <label>
            Assigned salesperson
            <select
              name="assigned_to"
              defaultValue={
                (existing ? existing.assigned_to : defaultAssignee) ?? ""
              }
              disabled={!manager}
            >
              <option value="">Unassigned · manager queue</option>
              {staff
                .filter((m) => m.active || m.id === existing?.assigned_to)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {!m.active ? " (inactive)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Lead source
              <select
                name="source"
                defaultValue={existing?.source ?? "Walk-in"}
              >
                {[
                  "Walk-in",
                  "Website",
                  "Facebook",
                  "Phone",
                  "Referral",
                  "Repeat customer",
                  "Other",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {section !== "trade" && (
        <section className="editor-section">
          <div className="form-section-title">
            <Car size={19} />
            <div>
              <h3>Vehicle of interest</h3>
              <p>Select stock or enter a vehicle manually.</p>
            </div>
          </div>
          <div className="segmented source-switch">
            {[
              ["inventory", "From inventory"],
              ["manual", "Manual vehicle"],
              ["none", "Not selected"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={mode === key ? "chosen" : ""}
                onClick={() => setMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "inventory" && (
            <>
              <label>
                Choose inventory vehicle
                <select
                  value={inventoryId}
                  onChange={(e) => setInventoryId(e.target.value)}
                >
                  <option value="">Select an in-stock vehicle…</option>
                  {available.map((v) => (
                    <option key={v.id} value={v.id}>
                      #{v.stock_number} · {vehicleName(v)} · {money(v.price)}
                      {v.status !== "in_stock"
                        ? " · " + v.status.replace("_", " ")
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <>
                  <p className="selected-vin">VIN {selected.vin}</p>
                  <VehicleFacts
                    vehicle={selected}
                    today={dayKey()}
                    showCosts={showCosts}
                  />
                </>
              )}
              {!available.length && (
                <p className="fine-print">
                  No in-stock vehicles yet. Add vehicles in Inventory, or choose
                  Manual vehicle above.
                </p>
              )}
            </>
          )}
          {mode === "manual" && (
            <>
              <label>
                Vehicle description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Year, make, model, trim"
                  maxLength={250}
                />
              </label>
              <VinField
                label="Vehicle VIN (optional)"
                vin={manual.vin}
                onChange={(vin) => setManual((v) => ({ ...v, vin }))}
                onDecoded={(d) => {
                  setManual((v) => applyDecoded(v, d));
                  setDescription(vehicleName(d));
                }}
                demo={demo}
              />
              <VehicleIdentity
                value={manual}
                onChange={(v) => {
                  setManual(v);
                  setDescription(vehicleName(vehicleValues(v)));
                }}
                prefix="Vehicle"
              />
              <div className="form-grid">
                {(
                  [
                    ["mileage", "Vehicle mileage"],
                    ["price", "Asking price"],
                    ["cost", "Vehicle cost"],
                    ["recon", "Reconditioning cost"],
                  ] as const
                )
                  .filter(
                    ([k]) => showCosts || !["cost", "recon", "acv"].includes(k),
                  )
                  .map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        max={k === "mileage" ? 3000000 : 1000000}
                        step={k === "mileage" ? 1 : 0.01}
                        value={manual[k]}
                        onChange={(e) =>
                          setManual({ ...manual, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                <label>
                  Acquired on (optional)
                  <input
                    type="date"
                    value={manual.acquired_on}
                    max={dayKey()}
                    onChange={(e) =>
                      setManual({ ...manual, acquired_on: e.target.value })
                    }
                  />
                </label>
              </div>
              <p className="fine-print">
                This vehicle stays with this customer. It does not create an
                inventory record.
              </p>
            </>
          )}
        </section>
      )}
      {section !== "vehicle" && (
        <section className="editor-section">
          <div className="form-section-title">
            <ArrowLeftRight size={19} />
            <div>
              <h3>Trade-in</h3>
              <p>Keep the vehicle and your working values together.</p>
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hasTrade}
              onChange={(e) => setHasTrade(e.target.checked)}
            />
            Customer has a trade-in
          </label>
          {hasTrade && (
            <>
              <VinField
                label="Trade VIN"
                vin={trade.vin}
                onChange={(vin) => setTrade((t) => ({ ...t, vin }))}
                onDecoded={(d) => {
                  setTrade((t) => applyDecoded(t, d));
                  setTradeDescription(vehicleName(d));
                }}
                required
                demo={demo}
              />
              <VehicleIdentity
                value={trade}
                onChange={(v) => {
                  setTrade(v);
                  setTradeDescription(vehicleName(vehicleValues(v)));
                }}
                prefix="Trade"
              />
              <label>
                Trade description
                <input
                  value={tradeDescription}
                  onChange={(e) => setTradeDescription(e.target.value)}
                  maxLength={250}
                  placeholder="Year, make, model, trim"
                />
              </label>
              <div className="form-grid">
                <label>
                  Trade mileage
                  <input
                    type="number"
                    min={0}
                    max={3000000}
                    step={1}
                    value={trade.mileage}
                    onChange={(e) =>
                      setTrade({ ...trade, mileage: e.target.value })
                    }
                    required
                  />
                </label>
                {(
                  [
                    ["allowance", "Trade allowance"],
                    ["acv", "Trade ACV (actual cash value)"],
                    ["payoff", "Trade payoff"],
                  ] as const
                )
                  .filter(
                    ([k]) => showCosts || !["cost", "recon", "acv"].includes(k),
                  )
                  .map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        max={1000000}
                        step=".01"
                        required={section !== "trade"}
                        placeholder={section === "trade" ? "0.00" : undefined}
                        value={values[k]}
                        onChange={(e) =>
                          setValues({ ...values, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
              </div>
              <p className="fine-print">
                {!showCosts
                  ? "Enter the trade vehicle, mileage, allowance and payoff. "
                  : section === "trade"
                    ? "VIN and mileage are required. Leave working figures blank to start at $0; you can update them in Desking. ACV stays internal."
                    : "All four figures and the VIN are required when a trade is present. Enter 0 for no payoff. ACV stays internal."}
              </p>
            </>
          )}
        </section>
      )}
      {section === "all" && (
        <label>
          Stage
          <select name="status" defaultValue={existing?.status ?? "new"}>
            {["new", "working", "appointment"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="modal-footer">
        <span>
          {section === "all"
            ? "Vehicle and trade figures carry into Desking."
            : "Updates this opportunity and carries into Desking. Saved quotes stay unchanged."}
        </span>
        <button className="btn primary" disabled={busy}>
          {busy
            ? "Saving…"
            : section === "vehicle"
              ? "Save vehicle"
              : section === "trade"
                ? "Save trade-in"
                : existing
                  ? "Save changes"
                  : "Create opportunity"}
        </button>
      </div>
    </form>
  );
}
