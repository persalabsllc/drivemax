"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  type DecodedVin,
  type VehicleDetails,
  normalizeVin,
  vinSchema,
} from "../lib/vehicles";
import { demoVinDecode } from "../lib/demo-vehicles";

export type VehicleDraft = { [K in keyof VehicleDetails]: string };
export const emptyVehicle: VehicleDraft = {
  vin: "",
  year: "",
  make: "",
  model: "",
  trim: "",
  mileage: "",
  stock_number: "",
  color: "",
  cost: "",
  recon: "",
  price: "",
  acquired_on: "",
};
export function vehicleDraft(v?: Partial<VehicleDetails> | null): VehicleDraft {
  return Object.fromEntries(
    Object.keys(emptyVehicle).map((k) => [
      k,
      String(v?.[k as keyof VehicleDetails] ?? ""),
    ]),
  ) as VehicleDraft;
}
export function vehicleValues(v: VehicleDraft): VehicleDetails {
  return {
    ...v,
    year: v.year === "" ? null : Number(v.year),
    mileage: v.mileage === "" ? null : Number(v.mileage),
    cost: v.cost === "" ? null : Number(v.cost),
    recon: v.recon === "" ? null : Number(v.recon),
    price: v.price === "" ? null : Number(v.price),
    acquired_on: v.acquired_on || null,
  };
}
export function applyDecoded(v: VehicleDraft, d: DecodedVin): VehicleDraft {
  return {
    ...v,
    year: d.year ? String(d.year) : "",
    make: d.make,
    model: d.model,
    trim: d.trim,
  };
}

export function VinField({
  label,
  vin,
  onChange,
  onDecoded,
  required = false,
  demo = false,
}: {
  label: string;
  vin: string;
  onChange: (v: string) => void;
  onDecoded: (v: DecodedVin) => void;
  required?: boolean;
  demo?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [warning, setWarning] = useState(false);
  const sequence = useRef(0),
    currentVin = useRef(vin),
    initial = useRef(vin),
    decodedCallback = useRef(onDecoded);
  currentVin.current = vin;
  decodedCallback.current = onDecoded;
  const decode = useCallback(
    async (value: string) => {
      const parsed = vinSchema.safeParse(value);
      if (!parsed.success) {
        setMessage(parsed.error.issues[0].message);
        setWarning(true);
        return;
      }
      const n = ++sequence.current;
      setBusy(true);
      setMessage("Decoding VIN…");
      setWarning(false);
      try {
        let data: DecodedVin;
        if (demo) {
          const result = demoVinDecode(parsed.data);
          if (!result)
            throw new Error(
              "Demo: try sample VIN 1HGCM82633A004352. Other VINs can be entered manually; live decoding is available after sign-in.",
            );
          data = result;
        } else {
          const res = await fetch(
            "/api/vin?vin=" + encodeURIComponent(parsed.data),
          );
          const result = await res.json();
          if (!res.ok) throw new Error(result.error);
          data = result;
        }
        if (n !== sequence.current || currentVin.current !== value) return;
        decodedCallback.current(data);
        setWarning(!!data.warning);
        setMessage(
          data.warning ||
            (demo
              ? "Sample VIN decoded. Confirm the vehicle details below."
              : "VIN decoded by NHTSA. Confirm trim and vehicle details below."),
        );
      } catch (e) {
        if (n === sequence.current) {
          setWarning(true);
          setMessage(
            e instanceof Error
              ? e.message
              : "Unable to decode. Enter the vehicle details manually.",
          );
        }
      } finally {
        if (n === sequence.current) setBusy(false);
      }
    },
    [demo],
  );
  useEffect(() => {
    if (vin === initial.current) return;
    initial.current = vin;
    if (!vinSchema.safeParse(vin).success) return;
    const t = setTimeout(() => void decode(vin), 650);
    return () => clearTimeout(t);
  }, [vin, decode]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  return (
    <div className="vin-field">
      <label>
        {label}
        <div className="vin-entry">
          <input
            value={vin}
            onChange={(e) => {
              sequence.current++;
              setBusy(false);
              setMessage("");
              onChange(normalizeVin(e.target.value));
            }}
            required={required}
            maxLength={17}
            minLength={vin ? 17 : undefined}
            pattern="[A-HJ-NPR-Z0-9]{17}"
            title="17-character VIN without I, O, or Q"
            placeholder="Enter 17-character VIN"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn"
            disabled={busy || vin.length !== 17}
            onClick={() => void decode(vin)}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ScanLine size={16} />
            )}
            Decode VIN
          </button>
        </div>
      </label>
      <p className={`vin-feedback ${warning ? "warning" : ""}`} role="status">
        {message ||
          "Year, make, model, and available trim decode automatically."}
      </p>
    </div>
  );
}
export function VehicleIdentity({
  value,
  onChange,
  required = false,
  prefix = "Vehicle",
}: {
  value: VehicleDraft;
  onChange: (v: VehicleDraft) => void;
  required?: boolean;
  prefix?: string;
}) {
  return (
    <div className="vehicle-identity form-grid">
      {(["year", "make", "model", "trim"] as const).map((k) => (
        <label key={k}>
          {k === "trim"
            ? "Trim / series"
            : k.charAt(0).toUpperCase() + k.slice(1)}
          <input
            aria-label={`${prefix} ${k}`}
            value={value[k]}
            type={k === "year" ? "number" : "text"}
            min={k === "year" ? 1900 : undefined}
            max={k === "year" ? 2100 : undefined}
            maxLength={k === "year" ? undefined : 250}
            required={required && k !== "trim"}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
export function VehicleFacts({
  vehicle,
  today,
  compact = false,
}: {
  vehicle: VehicleDetails;
  today: string;
  compact?: boolean;
}) {
  const age = vehicle.acquired_on
    ? Math.max(
        0,
        Math.round(
          (Date.parse(today + "T12:00:00Z") -
            Date.parse(vehicle.acquired_on + "T12:00:00Z")) /
            86400000,
        ),
      )
    : null;
  const dollars = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(n);
  return (
    <div className={`vehicle-facts ${compact ? "compact" : ""}`}>
      <div>
        <span>Stock #</span>
        <strong>{vehicle.stock_number || "Manual vehicle"}</strong>
      </div>
      <div>
        <span>Miles</span>
        <strong>{vehicle.mileage?.toLocaleString() ?? "—"}</strong>
      </div>
      <div>
        <span>Days on hand</span>
        <strong>{age ?? "—"}</strong>
      </div>
      <div>
        <span>Asking price</span>
        <strong>{dollars(vehicle.price)}</strong>
      </div>
      <div>
        <span>Vehicle cost · internal</span>
        <strong>{dollars(vehicle.cost)}</strong>
      </div>
      <div>
        <span>Total invested · internal</span>
        <strong>
          {vehicle.cost === null
            ? "—"
            : dollars(vehicle.cost + (vehicle.recon ?? 0))}
        </strong>
      </div>
    </div>
  );
}
