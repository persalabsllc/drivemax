"use client";
import { useEffect, useState } from "react";
import {
  normalizeVin,
  VIN_PATTERN,
  type DecodedVehicle,
} from "../../lib/vehicle-data";

export default function VinLookup({
  vin,
  onVinChange,
  onDecoded,
  onBusyChange,
  initialVin = "",
  name = "vin",
  disabled = false,
}: {
  vin: string;
  onVinChange: (value: string) => void;
  onDecoded: (value: DecodedVehicle) => void;
  onBusyChange?: (busy: boolean) => void;
  initialVin?: string;
  name?: string;
  disabled?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const valid = VIN_PATTERN.test(vin);
  useEffect(() => {
    setNotice("");
    setError(false);
    setBusy(false);
    onBusyChange?.(false);
    if (!VIN_PATTERN.test(vin) || (vin === initialVin && attempt === 0)) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      onBusyChange?.(true);
      try {
        const response = await fetch(
          `/api/vehicles/decode?vin=${encodeURIComponent(vin)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error ||
              "VIN lookup is unavailable. You can enter the details manually.",
          );
        if (!active) return;
        if (data.vin !== vin || !data.fields)
          throw new Error("The VIN response could not be matched. Try again.");
        onDecoded(data as DecodedVehicle);
        setNotice(
          data.warning ||
            "VIN decoded. Available details have been filled in; review and complete the remaining fields.",
        );
      } catch (err) {
        if (!active) return;
        setError(true);
        setNotice(
          err instanceof Error
            ? err.message
            : "VIN lookup is unavailable. You can enter the details manually.",
        );
      } finally {
        if (active) {
          setBusy(false);
          onBusyChange?.(false);
        }
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [vin, attempt, initialVin, onDecoded, onBusyChange]);
  return (
    <div className="vin-lookup">
      <label htmlFor={`${name}-lookup`}>
        Vehicle identification number (VIN)
      </label>
      <div className="vin-lookup-row">
        <input
          id={`${name}-lookup`}
          name={name}
          value={vin}
          onChange={(e) => onVinChange(normalizeVin(e.target.value))}
          required
          pattern="[A-HJ-NPR-Z0-9]{17}"
          minLength={17}
          maxLength={50}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the 17-character VIN"
          aria-describedby={`${name}-lookup-help`}
          disabled={disabled}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={!valid || busy || disabled}
          onClick={() => setAttempt((n) => n + 1)}
        >
          {busy ? "Decoding…" : "Decode VIN"}
        </button>
      </div>
      <p id={`${name}-lookup-help`} className="form-help">
        Paste a VIN to fill in vehicle details automatically. You can also enter
        or edit the details yourself.
      </p>
      {notice && (
        <p
          className={error ? "form-status form-status-error" : "form-status"}
          role={error ? "alert" : "status"}
        >
          {notice}
        </p>
      )}
    </div>
  );
}
