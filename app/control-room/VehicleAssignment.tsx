"use client";
import { useState } from "react";
import Link from "next/link";
import { leadVehicleTitle, type LeadVehicle } from "../../lib/lead-vehicles";

export default function VehicleAssignment({
  vehicle,
  vehicles,
  disabled,
}: {
  vehicle: LeadVehicle | null;
  vehicles: LeadVehicle[];
  disabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState(vehicle?.id || "");
  const [search, setSearch] = useState("");
  const selected =
    vehicles.find((v) => v.id === selectedId) ||
    (vehicle?.id === selectedId ? vehicle : null);
  const options = vehicles.filter(
    (v) =>
      v.id === selectedId ||
      `${leadVehicleTitle(v)} ${v.stock_number} ${v.vin}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const changed = selectedId !== (vehicle?.id || "");
  return (
    <fieldset className="cr-fieldset cr-vehicle-assignment" disabled={disabled}>
      <legend>Vehicle of interest</legend>
      <div className="cr-grid">
        <label>
          Find an inventory vehicle
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Year, make, model, stock number, or VIN"
          />
        </label>
        <label>
          Assigned vehicle
          <select
            name="vehicle_id"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">No vehicle assigned</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {leadVehicleTitle(v)} · {v.stock_number} · {v.status}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected ? (
        <div className="cr-assigned-vehicle">
          <strong>{leadVehicleTitle(selected)}</strong>
          <dl className="cr-details">
            <div>
              <dt>VIN</dt>
              <dd>{selected.vin}</dd>
            </div>
            <div>
              <dt>Current inventory mileage</dt>
              <dd>{selected.miles.toLocaleString("en-US")} miles</dd>
            </div>
            <div>
              <dt>Stock number</dt>
              <dd>{selected.stock_number}</dd>
            </div>
          </dl>
          <div className="cr-contact-row">
            <span className={`cr-badge ${selected.status}`}>
              {selected.status}
            </span>
            <Link href={`/control-room?tab=inventory&vehicle=${selected.id}`}>
              Open inventory record →
            </Link>
            {["available", "pending", "sold"].includes(selected.status) && (
              <Link href={`/inventory/${selected.slug}`} target="_blank">
                Public listing ↗
              </Link>
            )}
          </div>
        </div>
      ) : (
        <p className="cr-muted">
          Assign a vehicle to track this customer's interest against your
          inventory.
        </p>
      )}
      {changed && (
        <p className="cr-status-help" role="status">
          Vehicle change is not saved yet. Choose Update lead to save it.
        </p>
      )}
    </fieldset>
  );
}
