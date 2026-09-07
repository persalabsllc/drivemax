"use client";
import { useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink } from "lucide-react";

export default function VehicleHistory({ vin }: { vin: string }) {
  const [notice, setNotice] = useState("");
  const reportUrl = `https://secure.carfax.com/creditCard.cfx?${new URLSearchParams({ previousPage: "vhrl", vin })}`;
  return (
    <section
      className="vehicle-history"
      aria-labelledby="vehicle-history-heading"
    >
      <span className="kicker">Know the vehicle</span>
      <h2 id="vehicle-history-heading">Vehicle history</h2>
      <p>
        Open CARFAX with this vehicle’s VIN already included. Review the
        available report options and choose whether to purchase directly from
        CARFAX.
      </p>
      <div className="vehicle-history-vin">
        <code>{vin}</code>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(vin);
              setNotice("VIN copied.");
            } catch {
              setNotice(
                "Select and copy the VIN shown here if you need it on CARFAX.",
              );
            }
          }}
        >
          <Copy size={16} aria-hidden="true" />
          Copy VIN
        </button>
      </div>
      <a
        className="carfax-report-link"
        href={reportUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View CARFAX purchase options for VIN ${vin} (opens in a new tab)`}
      >
        <Image
          src="https://static.carfax.com/global-header/imgs/logo.svg"
          alt="CARFAX"
          width={172}
          height={36}
          unoptimized
        />
        <span>
          View report purchase options{" "}
          <ExternalLink size={16} aria-hidden="true" />
        </span>
      </a>
      <p className="form-help">
        A CARFAX report is an optional paid purchase. Current pricing and report
        availability are shown by CARFAX. Clicking the logo does not purchase a
        report.
      </p>
      {notice && (
        <p className="form-status" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
