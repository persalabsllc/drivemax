import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicInventory, publicVehicle, photoUrl } from "../../../lib/backend";
import {
  money,
  vehicleTitle,
  schemaAvailability,
} from "../../../lib/inventory";
import VehicleGallery from "../../_components/VehicleGallery";
import VehicleCard from "../../_components/VehicleCard";
import LeadForm from "../../_components/ConnectedLeadForm";
import VehicleHistory from "../../_components/VehicleHistory";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await publicVehicle((await params).slug);
  if (!v) return { title: "Vehicle not found", robots: { index: false } };
  const title = `${v.status === "sold" ? "SOLD — " : v.status === "pending" ? "Sale pending — " : ""}${vehicleTitle(v)}`;
  return {
    title,
    description: `${title} at Drive Max Used Cars in New Bern, NC. ${v.miles.toLocaleString()} miles. ${v.status === "sold" ? "This vehicle has sold. Browse our available inventory." : v.description.slice(0, 130)}`,
    alternates: { canonical: `/inventory/${v.slug}` },
    openGraph: { title, images: v.photos[0] ? [photoUrl(v.photos[0])] : [] },
  };
}
export default async function VehiclePage({ params }: Props) {
  const v = await publicVehicle((await params).slug);
  if (!v) notFound();
  const title = vehicleTitle(v),
    sold = v.status === "sold",
    pending = v.status === "pending";
  const alternatives = (await publicInventory("available"))
    .filter((a) => a.id !== v.id)
    .sort((a, b) => Number(b.make === v.make) - Number(a.make === v.make))
    .slice(0, 3);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Car",
    name: title,
    description: sold
      ? `${title} — SOLD. This vehicle is no longer available.`
      : v.description,
    vehicleIdentificationNumber: v.vin,
    vehicleModelDate: String(v.year),
    brand: { "@type": "Brand", name: v.make },
    model: v.model,
    itemCondition: "https://schema.org/UsedCondition",
    mileageFromOdometer: {
      "@type": "QuantitativeValue",
      value: v.miles,
      unitCode: "SMI",
    },
    image: v.photos.map(photoUrl),
    offers: {
      "@type": "Offer",
      url: `https://www.drivemaxusedcars.com/inventory/${v.slug}`,
      availability: schemaAvailability(v.status),
      ...(sold ? {} : { price: v.internet_price, priceCurrency: "USD" }),
    },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
      <section className="page-section">
        <div className="container">
          <Link className="text-link" href="/inventory">
            ← All inventory
          </Link>
          <div className="vehicle-detail-heading">
            <div>
              <span className="kicker">
                Stock {v.stock_number} · New Bern, NC
              </span>
              <h1>{title}</h1>
              <p>
                {v.miles.toLocaleString()} miles · {v.body_style}
              </p>
            </div>
            <span className={`vehicle-status ${sold ? "sold" : ""}`}>
              {sold ? "SOLD" : pending ? "Sale pending" : "Available"}
            </span>
          </div>
          {(sold || pending) && (
            <div className="vehicle-sold-banner">
              <strong>
                {sold
                  ? "This vehicle has found a new home."
                  : "A sale is pending on this vehicle."}
              </strong>
              <p>
                {sold
                  ? "It is no longer available for purchase. Explore our current inventory or ask us to find something similar."
                  : "Browse our available inventory or contact us for an update."}
              </p>
              <Link className="button button-primary" href="/inventory">
                Shop available vehicles
              </Link>
            </div>
          )}
          <div className="vehicle-detail-grid">
            <VehicleGallery photos={v.photos.map(photoUrl)} title={title} />
            <aside className="vehicle-detail-summary">
              <span className="kicker">
                {sold ? "Listing status" : "Internet price"}
              </span>
              <strong className="vehicle-detail-price">
                {sold ? "Sold" : money(v.internet_price)}
              </strong>
              <p>
                {sold
                  ? "Browse similar available vehicles below."
                  : "Confirm final out-the-door pricing with the dealership."}
              </p>
              <dl>
                {[
                  ["Mileage", `${v.miles.toLocaleString()} miles`],
                  ["VIN", v.vin],
                  ["Stock number", v.stock_number],
                  ["Exterior", v.exterior],
                  ["Transmission", v.transmission],
                  ["Drivetrain", v.drivetrain],
                  ["Fuel", v.fuel],
                ]
                  .filter(([, x]) => x)
                  .map(([k, x]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{x}</dd>
                    </div>
                  ))}
              </dl>
              <a className="button button-primary" href="#vehicle-inquiry">
                {sold
                  ? "Find me something similar"
                  : pending
                    ? "Ask for an update"
                    : "Ask about this vehicle"}
              </a>
            </aside>
          </div>
          <div className="vehicle-detail-text">
            <h2>
              About this {v.make} {v.model}
            </h2>
            <p>{v.description}</p>
            {v.features.length > 0 && (
              <>
                <h2>Features & equipment</h2>
                <ul className="vehicle-features">
                  {v.features.map((f, i) => (
                    <li key={`${i}-${f}`}>{f}</li>
                  ))}
                </ul>
                {v.features.some((f) => f.startsWith("NHTSA ")) && (
                  <p className="form-help">
                    Crash-test ratings apply to the vehicle version shown.{" "}
                    <a
                      className="text-link"
                      href="https://www.nhtsa.gov/ratings"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      About NHTSA safety ratings ↗
                    </a>
                  </p>
                )}
              </>
            )}
            {!sold && v.financing && (
              <>
                <h2>Financing options</h2>
                <p>{v.financing}</p>
                <p className="form-help">
                  Financing is subject to lender approval and applicable terms.
                </p>
              </>
            )}
          </div>
          <VehicleHistory vin={v.vin} />
        </div>
      </section>
      <section className="page-section page-section-muted" id="vehicle-inquiry">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Let’s talk</span>
            <h2>
              {sold
                ? "Looking for something similar?"
                : `Interested in this ${v.make}?`}
            </h2>
            <p>
              {sold
                ? `This ${title} is sold. Tell us what you liked about it and we’ll help you explore other options.`
                : "Send a question or ask to schedule a visit. Your inquiry will include this vehicle."}
            </p>
          </div>
          <LeadForm kind="vehicle" vehicleId={v.id} />
        </div>
      </section>
      {alternatives.length > 0 && (
        <section className="page-section">
          <div className="container">
            <div className="section-heading">
              <span className="kicker">Available now</span>
              <h2>More possibilities on the lot.</h2>
            </div>
            <div className="vehicle-grid">
              {alternatives.map((a) => (
                <VehicleCard key={a.id} vehicle={a} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
