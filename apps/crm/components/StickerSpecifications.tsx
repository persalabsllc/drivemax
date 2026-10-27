"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  mergeVinSpecs,
  selectEpaSpecs,
  type EpaImportedFields,
  type EpaOption,
  type SpecsLookup,
  type StickerSpecs,
} from "../lib/vehicle-specifications";
import type { InventoryVehicle } from "../lib/vehicles";

export default function StickerSpecifications({
  vehicle,
  specs,
  onChange,
  onBusy,
}: {
  vehicle: InventoryVehicle;
  specs: StickerSpecs;
  onChange: (update: (current: StickerSpecs) => StickerSpecs) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState<EpaOption[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const epaImported = useRef<EpaImportedFields>({});
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      onBusy(false);
    },
    [onBusy],
  );
  const change = (key: keyof StickerSpecs, value: string) =>
    onChange((current) => ({ ...current, [key]: value }));

  async function lookup(epaId?: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    onBusy(true);
    setNotice("");
    setWarnings([]);
    if (epaId)
      onChange((current) => ({
        ...current,
        cityMpg: "",
        highwayMpg: "",
        combinedMpg: "",
        epaId: "",
        epaLabel: "",
        economyFuel: "",
      }));
    try {
      const params = new URLSearchParams({
        vin: vehicle.vin,
        year: String(vehicle.year),
        make: vehicle.make,
        model: vehicle.model,
        ...(epaId ? { epaId } : {}),
      });
      const response = await fetch(`/api/vehicle-specifications?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Vehicle details could not be loaded.");
      if (request.current !== controller) return;
      if (epaId) {
        const next = data.specs as StickerSpecs;
        const previous = epaImported.current;
        epaImported.current = selectEpaSpecs(specs, next, previous).imported;
        onChange((current) => selectEpaSpecs(current, next, previous).specs);
        setNotice(
          "EPA ratings added. Confirm that this engine, transmission and drivetrain match the vehicle.",
        );
      } else {
        const result = data as SpecsLookup;
        onChange((current) => mergeVinSpecs(current, result.specs));
        setOptions(result.options);
        setWarnings(result.warnings);
        setNotice(
          result.specs.vinDecoded
            ? "Available VIN specifications added. Your existing entries were kept. Review equipment and choose the matching EPA configuration below."
            : "You can still enter confirmed specifications manually.",
        );
      }
    } catch (error) {
      if (request.current === controller)
        setWarnings([
          error instanceof Error
            ? error.message
            : "Lookup unavailable. Enter confirmed details manually.",
        ]);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
        onBusy(false);
      }
    }
  }

  const changeEconomy = (
    key:
      "cityMpg" | "highwayMpg" | "combinedMpg" | "economyUnit" | "economyFuel",
    value: string,
  ) => {
    onChange((current) => ({
      ...current,
      [key]: value,
      epaId: "",
      epaLabel: "",
    }));
  };

  return (
    <div className="sticker-specifications">
      <div className="sticker-lookup">
        <div>
          <h4>Build out your window sticker</h4>
          <p>
            Look up available engine, horsepower and safety equipment by VIN,
            then choose a fuel-economy match. Review all details before
            printing.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => void lookup()}
        >
          <Sparkles size={16} />
          {pending ? "Looking up…" : "Auto-fill vehicle specs"}
        </button>
      </div>
      {notice && (
        <p className="inventory-print-notice" role="status">
          {notice}
        </p>
      )}
      {warnings.map((warning) => (
        <p className="sticker-lookup-warning" role="status" key={warning}>
          {warning}
        </p>
      ))}
      <div className="inventory-print-grid">
        {(
          [
            ["engine", "Engine"],
            ["horsepower", "Horsepower (hp)"],
            ["transmission", "Transmission"],
            ["drivetrain", "Drivetrain"],
            ["fuel", "Fuel type"],
            ["body", "Body style"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              value={specs[key]}
              maxLength={key === "horsepower" ? 25 : 90}
              onChange={(e) => change(key, e.target.value)}
              placeholder="Not listed"
            />
          </label>
        ))}
      </div>
      <label className="sticker-equipment">
        Features & equipment{" "}
        <small>
          Up to 12 lines. VIN data may not include every standard or optional
          feature. Add only equipment confirmed on this vehicle.
        </small>
        <textarea
          aria-label="Features and equipment"
          rows={6}
          maxLength={1000}
          value={specs.features}
          onChange={(e) => change("features", e.target.value)}
          placeholder={"Leather seating\nHeated front seats\nRearview camera"}
        />
      </label>
      <div className="sticker-economy">
        <h4>Fuel economy</h4>
        {options.length > 0 && (
          <label>
            Match the vehicle’s engine, transmission & drivetrain
            <select
              aria-label="EPA vehicle configuration"
              value={
                options.some((o) => o.id === specs.epaId) ? specs.epaId : ""
              }
              disabled={pending}
              onChange={(e) => {
                if (e.target.value) void lookup(e.target.value);
              }}
            >
              <option value="">Select a matching configuration…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="inventory-print-grid sticker-economy-grid">
          {(
            [
              ["cityMpg", "City"],
              ["highwayMpg", "Highway"],
              ["combinedMpg", "Combined"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={`${label} fuel economy`}
                type="number"
                min="0.1"
                max="500"
                step="0.1"
                value={specs[key]}
                onChange={(e) => changeEconomy(key, e.target.value)}
                placeholder="—"
              />
            </label>
          ))}
          <label>
            Units
            <select
              aria-label="Fuel economy units"
              value={specs.economyUnit}
              onChange={(e) => changeEconomy("economyUnit", e.target.value)}
            >
              <option value="MPG">MPG</option>
              <option value="MPGe">MPGe</option>
            </select>
          </label>
        </div>
        <label>
          Rating fuel / mode
          <input
            aria-label="Fuel economy fuel or mode"
            value={specs.economyFuel}
            maxLength={90}
            onChange={(e) => changeEconomy("economyFuel", e.target.value)}
            placeholder="Example: Regular gasoline or electricity"
          />
        </label>
        <p className="inventory-print-help">
          {specs.epaId ? (
            <>
              EPA match: {specs.epaLabel}.{" "}
              <a
                href={`https://www.fueleconomy.gov/feg/noframes/${specs.epaId}.shtml`}
                target="_blank"
                rel="noreferrer"
              >
                View source
              </a>
              . Editing a rating removes the EPA attribution.
            </>
          ) : (
            "Leave unavailable figures blank. Manually entered figures print as dealer-provided ratings; actual mileage varies."
          )}
        </p>
      </div>
    </div>
  );
}
