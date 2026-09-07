"use client";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

export default function VehicleHistory({ vin }: { vin: string }) {
  const [notice, setNotice] = useState("");
  return (
    <section
      className="vehicle-history"
      aria-labelledby="vehicle-history-heading"
    >
      <span className="kicker">Know the vehicle</span>
      <h2 id="vehicle-history-heading">Vehicle history</h2>
      <p>
        Copy this vehicle’s VIN and enter it in the free report lookup from
        Carsforsale.com.
      </p>
      <div className="vehicle-history-vin">
        <code>{vin}</code>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(vin);
              setNotice("VIN copied. Paste it into the report lookup.");
            } catch {
              setNotice(
                "Select and copy the VIN shown here, then paste it into the report lookup.",
              );
            }
          }}
        >
          <Copy size={16} aria-hidden="true" />
          Copy VIN
        </button>
      </div>
      <div className="button-row">
        <a
          className="button button-primary"
          href="https://www.carsforsale.com/free-vehicle-history-reports"
          target="_blank"
          rel="noopener noreferrer"
        >
          Free report lookup
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <a
          className="text-link"
          href="https://www.nicb.org/vincheck"
          target="_blank"
          rel="noopener noreferrer"
        >
          Free theft & salvage check ↗
        </a>
      </div>
      <p className="form-help">
        Carsforsale.com requires a free account; report availability and detail
        vary by VIN. NICB’s separate VINCheck covers theft and salvage records
        from participating insurers.
      </p>
      {notice && (
        <p className="form-status" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
