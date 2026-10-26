"use client";
import { useState } from "react";
import { Car, ArrowLeftRight } from "lucide-react";
import {
  type Customer,
  type Command,
  dayKey,
  commandSchema,
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
export function CustomerForm({
  existing,
  inventory,
  busy,
  error,
  demo,
  submit,
}: {
  existing: Customer | null;
  inventory: InventoryVehicle[];
  busy: boolean;
  error: string;
  demo: boolean;
  submit: (
    data: Extract<Command, { type: "create_customer" }>["customer"],
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
        let structuredTrade = null;
        if (hasTrade) {
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
                v === "" ? null : Number(v),
              ]),
            ),
          });
          if (!t.success) {
            setLocalError(
              "Complete the trade VIN, mileage, allowance, ACV, and payoff. Enter 0 where appropriate.",
            );
            return;
          }
          structuredTrade = t.data;
        }
        const data = {
          name: String(f.get("name")),
          email: String(f.get("email")),
          phone: String(f.get("phone")),
          source: String(f.get("source")),
          status: String(f.get("status") || "new") as Customer["status"],
          birthday: String(f.get("birthday")) || null,
          inventory_id: mode === "inventory" ? (selected?.id ?? null) : null,
          vehicle_details:
            mode === "inventory"
              ? selected
                ? inventorySnapshot(selected)
                : null
              : mode === "manual"
                ? vehicleValues(manual)
                : null,
          vehicle_interest:
            mode === "inventory"
              ? selected
                ? vehicleName(selected)
                : ""
              : mode === "manual"
                ? description || vehicleName(vehicleValues(manual))
                : "",
          trade: structuredTrade,
          trade_vehicle: structuredTrade
            ? structuredTrade.description ||
              vehicleName(structuredTrade) ||
              structuredTrade.vin
            : "",
        };
        const checked = commandSchema.safeParse({
          type: "create_customer",
          customer: data,
        });
        if (!checked.success) {
          setLocalError(checked.error.issues[0].message);
          return;
        }
        await submit(data);
      }}
    >
      <label>
        Full name
        <input
          name="name"
          defaultValue={existing?.name}
          placeholder="Customer’s name"
          required
          minLength={2}
          maxLength={250}
          autoFocus
        />
      </label>
      <div className="form-grid">
        <label>
          Phone
          <input
            name="phone"
            type="tel"
            defaultValue={existing?.phone}
            placeholder="(252) 555-0123"
            maxLength={30}
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue={existing?.email}
            placeholder="customer@example.com"
            maxLength={250}
          />
        </label>
        <label>
          Lead source
          <select name="source" defaultValue={existing?.source ?? "Walk-in"}>
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
        <label>
          Birthday
          <input
            name="birthday"
            type="date"
            defaultValue={existing?.birthday ?? ""}
          />
        </label>
      </div>
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
                <VehicleFacts vehicle={selected} today={dayKey()} />
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
              ).map(([k, label]) => (
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
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step=".01"
                    required
                    value={values[k]}
                    onChange={(e) =>
                      setValues({ ...values, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="fine-print">
              All four figures and the VIN are required when a trade is present.
              Enter 0 for no payoff. ACV stays internal.
            </p>
          </>
        )}
      </section>
      {existing && (
        <label>
          Stage
          <select
            name="status"
            defaultValue={existing.status}
            disabled={existing.status === "sold"}
          >
            {(existing.status === "sold"
              ? ["sold"]
              : ["new", "working", "appointment", "lost"]
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {existing.status === "sold" && (
            <input type="hidden" name="status" value="sold" />
          )}
        </label>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="modal-footer">
        <span>Vehicle and trade figures carry into Desking.</span>
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save changes" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
