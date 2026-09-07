"use client";
import { useEffect, useRef, useState } from "react";
import type {
  SafetyRatings as Ratings,
  SafetyVariant,
} from "../../lib/vehicle-data";

export default function SafetyRatings({
  year,
  make,
  model,
  disabled,
  onImport,
}: {
  year: string;
  make: string;
  model: string;
  disabled: boolean;
  onImport: (features: string[]) => void;
}) {
  const [variants, setVariants] = useState<SafetyVariant[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<Ratings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load(variant = "") {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice("");
    setData(null);
    if (!variant) {
      setVariants([]);
      setSelected("");
    }
    try {
      const params = new URLSearchParams({
        year,
        make,
        model,
        ...(variant ? { variant } : {}),
      });
      const r = await fetch(`/api/control-room/ratings?${params}`, {
        signal: controller.signal,
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.error || "Could not load safety ratings.");
      if (controller.signal.aborted) return;
      if (variant) {
        setData(body);
        if (!body.ratings.length)
          setNotice(
            "NHTSA has not published star ratings for this vehicle version.",
          );
      } else {
        setVariants(body.variants);
        if (!body.variants.length)
          setNotice(
            "No matching NHTSA ratings were found. You can still save this vehicle.",
          );
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not load safety ratings.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="cr-rating-lookup">
      <div className="cr-section-heading">
        <div>
          <h3>NHTSA safety ratings</h3>
          <p className="cr-muted">
            Choose the matching body style and drivetrain before adding ratings
            to the listing.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || busy || !year || !make || !model}
          onClick={() => void load()}
        >
          {busy ? "Looking up…" : "Find safety ratings"}
        </button>
      </div>
      {variants.length > 0 && (
        <div className="cr-grid">
          <label>
            Rated vehicle version
            <select
              value={selected}
              disabled={busy || disabled}
              onChange={(e) => {
                setSelected(e.target.value);
                setData(null);
                if (e.target.value) void load(e.target.value);
              }}
            >
              <option value="">Choose the matching vehicle</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.description}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {data && data.ratings.length > 0 && (
        <div className="cr-rating-results">
          <strong>{data.variant.description}</strong>
          <ul>
            {data.ratings.map((r) => (
              <li key={r.label}>
                {r.label}: <strong>{r.stars}/5 stars</strong>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled || busy}
            onClick={() => {
              onImport(data.features);
              setNotice(
                "Ratings added to Features. Save the vehicle to publish them.",
              );
            }}
          >
            Add ratings to features
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="cr-status-help">
          {notice}
        </p>
      )}
      <a
        className="text-link"
        href="https://www.nhtsa.gov/ratings"
        target="_blank"
        rel="noopener noreferrer"
      >
        NHTSA ratings source ↗
      </a>
    </section>
  );
}
