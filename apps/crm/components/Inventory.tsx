"use client";
import { DeleteVehicle } from "./DeleteVehicle";
import { useState } from "react";
import { Car, Search, Plus, ArrowUpRight } from "lucide-react";
import { type Command, dayKey, money } from "../lib/model";
import {
  type InventoryVehicle,
  inventorySchema,
  daysOnHand,
  vehicleName,
} from "../lib/vehicles";
import {
  VehicleIdentity,
  VinField,
  vehicleDraft,
  vehicleValues,
  applyDecoded,
  VehicleFacts,
} from "./VehicleFields";
import { Badge, Empty } from "./ui";
export function InventoryView({
  inventory,
  onEdit,
  onAdd,
}: {
  inventory: InventoryVehicle[];
  onEdit: (v: InventoryVehicle) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState("in_stock"),
    [search, setSearch] = useState("");
  const today = dayKey();
  const selected = inventory
    .filter(
      (v) =>
        (filter === "all" || v.status === filter) &&
        [vehicleName(v), v.vin, v.stock_number]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => a.acquired_on.localeCompare(b.acquired_on));
  const stock = inventory.filter((v) => v.status === "in_stock");
  return (
    <>
      <div className="inventory-summary">
        <div>
          <span>In stock</span>
          <strong>{stock.length}</strong>
        </div>
        <div>
          <span>Total invested</span>
          <strong>
            {money(stock.reduce((s, v) => s + v.cost + v.recon, 0))}
          </strong>
        </div>
        <div>
          <span>Retail asking value</span>
          <strong>{money(stock.reduce((s, v) => s + v.price, 0))}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="inventory-toolbar">
          <div className="segmented">
            {["in_stock", "pending", "sold", "archived", "all"].map((s) => (
              <button
                key={s}
                className={filter === s ? "chosen" : ""}
                onClick={() => setFilter(s)}
              >
                {s === "all" ? "All vehicles" : s.replace("_", " ")}
              </button>
            ))}
          </div>
          <label className="inventory-search">
            <Search size={16} />
            <input
              aria-label="Search inventory"
              placeholder="Stock #, VIN, or vehicle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {selected.length ? (
          <div className="table-scroll">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Vehicle / stock</th>
                  <th>Miles</th>
                  <th>Days on hand</th>
                  <th>Cost</th>
                  <th>Asking price</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button className="name-button" onClick={() => onEdit(v)}>
                        {vehicleName(v)}
                      </button>
                      <small className="subtext">
                        #{v.stock_number} · {v.color || "Color not entered"}
                      </small>
                      <small className="subtext vin-text">{v.vin}</small>
                    </td>
                    <td>{v.mileage.toLocaleString()}</td>
                    <td>
                      <span
                        className={`age-badge ${(daysOnHand(v.acquired_on, today) ?? 0) >= 60 ? "aged" : ""}`}
                      >
                        {daysOnHand(v.acquired_on, today)} days
                      </span>
                    </td>
                    <td>
                      {money(v.cost)}
                      <small className="subtext">
                        {money(v.cost + v.recon)} invested
                      </small>
                    </td>
                    <td>
                      <strong>{money(v.price)}</strong>
                    </td>
                    <td>
                      <Badge value={v.status} />
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`Edit stock ${v.stock_number}`}
                        onClick={() => onEdit(v)}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              inventory.length
                ? "No vehicles in this view."
                : "Your inventory starts here."
            }
            body={
              inventory.length
                ? "Change the status filter or search."
                : "Add your vehicles once, then select them from any customer profile."
            }
            action={
              <button className="btn primary" onClick={onAdd}>
                <Plus size={16} />
                Add vehicle
              </button>
            }
          />
        )}
        <div className="panel-foot">
          Inventory cost and investment figures stay internal. Days on hand are
          calculated from the acquisition date.
        </div>
      </section>
    </>
  );
}
export function InventoryForm({
  existing,
  busy,
  error,
  demo,
  submit,
  onDelete,
}: {
  onDelete?: (reason: string) => Promise<boolean>;
  existing: InventoryVehicle | null;
  busy: boolean;
  error: string;
  demo: boolean;
  submit: (p: Extract<Command, { type: "save_inventory" }>) => Promise<unknown>;
}) {
  const [v, setV] = useState(() => ({
      ...vehicleDraft(existing),
      recon: String(existing?.recon ?? 0),
      acquired_on: existing?.acquired_on ?? dayKey(),
    })),
    [status, setStatus] = useState(existing?.status ?? "in_stock"),
    [localError, setLocalError] = useState("");
  return (
    <form
      className="modal-form inventory-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = inventorySchema.safeParse({
          ...vehicleValues(v),
          status,
        });
        if (!parsed.success) {
          setLocalError(parsed.error.issues[0].message);
          return;
        }
        if (parsed.data.acquired_on > dayKey()) {
          setLocalError("Acquisition date cannot be in the future.");
          return;
        }
        setLocalError("");
        await submit({
          type: "save_inventory",
          ...(existing ? { id: existing.id } : {}),
          vehicle: parsed.data,
        });
      }}
    >
      <VinField
        label="Inventory VIN"
        vin={v.vin}
        onChange={(vin) => setV((p) => ({ ...p, vin }))}
        onDecoded={(d) => setV((p) => applyDecoded(p, d))}
        required
        demo={demo}
      />
      <VehicleIdentity value={v} onChange={setV} required prefix="Inventory" />
      <div className="form-grid">
        <label>
          Stock number
          <input
            value={v.stock_number}
            onChange={(e) => setV({ ...v, stock_number: e.target.value })}
            required
            maxLength={250}
          />
        </label>
        <label>
          Mileage
          <input
            type="number"
            min={0}
            max={3000000}
            step={1}
            value={v.mileage}
            onChange={(e) => setV({ ...v, mileage: e.target.value })}
            required
          />
        </label>
        <label>
          Exterior color
          <input
            value={v.color}
            onChange={(e) => setV({ ...v, color: e.target.value })}
            maxLength={250}
          />
        </label>
        <label>
          Inventory status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {["in_stock", "pending", "sold", "archived"].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-section-title">
        <Car size={18} />
        <div>
          <h3>Acquisition & pricing</h3>
          <p>These figures fill the customer’s desking worksheet.</p>
        </div>
      </div>
      <div className="form-grid">
        {(
          [
            ["cost", "Vehicle cost"],
            ["recon", "Reconditioning cost"],
            ["price", "Asking price"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={1000000}
              step=".01"
              required
              value={v[key]}
              onChange={(e) => setV({ ...v, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          Acquired on
          <input
            type="date"
            value={v.acquired_on}
            max={dayKey()}
            required
            onChange={(e) => setV({ ...v, acquired_on: e.target.value })}
          />
        </label>
      </div>
      <VehicleFacts vehicle={vehicleValues(v)} today={dayKey()} compact />
      {(error || localError) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      {existing && onDelete && (
        <DeleteVehicle
          label="vehicle"
          busy={busy}
          blocked={
            ["sold", "pending"].includes(existing.status)
              ? "Resolve the active or sold deal before deleting this vehicle."
              : undefined
          }
          onDelete={onDelete}
        />
      )}
      <div className="modal-footer">
        <span>Each vehicle belongs to your dealership.</span>
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save vehicle" : "Add to inventory"}
        </button>
      </div>
    </form>
  );
}
