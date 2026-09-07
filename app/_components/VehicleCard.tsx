import Image from "next/image";
import Link from "next/link";
import { CarFront, ArrowRight } from "lucide-react";
import { photoUrl } from "../../lib/backend";
import { vehicleTitle, type Vehicle } from "../../lib/inventory";
import VehiclePricing from "./VehiclePricing";
export default function VehicleCard({ vehicle: v }: { vehicle: Vehicle }) {
  const sold = v.status === "sold";
  return (
    <article className={`vehicle-card${sold ? " vehicle-sold" : ""}`}>
      <Link
        href={`/inventory/${v.slug}`}
        className="vehicle-card-photo"
        aria-label={`View ${vehicleTitle(v)}${sold ? " — sold" : ""}`}
      >
        {v.photos[0] ? (
          <Image
            src={photoUrl(v.photos[0])}
            alt={vehicleTitle(v)}
            fill
            sizes="(max-width:760px) 100vw, (max-width:1100px) 50vw, 33vw"
          />
        ) : (
          <CarFront size={60} />
        )}
        <span className={`vehicle-status ${sold ? "sold" : ""}`}>
          {sold ? "SOLD" : "Available"}
        </span>
      </Link>
      <div className="vehicle-card-copy">
        <span className="kicker">
          {v.body_style || "Used vehicle"} · Stock {v.stock_number}
        </span>
        <h3>
          <Link href={`/inventory/${v.slug}`}>{vehicleTitle(v)}</Link>
        </h3>
        <p>
          {v.miles.toLocaleString("en-US")} miles{" "}
          {v.transmission && `· ${v.transmission}`}
        </p>
        {!sold && <VehiclePricing price={v.internet_price} />}
        <div className="vehicle-card-price">
          {sold && <strong>Sold</strong>}
          <Link href={`/inventory/${v.slug}`} className="text-link">
            {sold ? "View details" : "Take a look"} <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}
