import Image from "next/image";
import { ExternalLink } from "lucide-react";

export default function VehicleHistory({ vin }: { vin: string }) {
  const reportUrl = `https://secure.carfax.com/creditCard.cfx?${new URLSearchParams({ previousPage: "vhrl", vin })}`;
  return (
    <section className="vehicle-history" aria-label="Vehicle history">
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
    </section>
  );
}
