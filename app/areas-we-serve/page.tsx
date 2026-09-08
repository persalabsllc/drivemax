import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import {
  breadcrumbSchema,
  jsonLd,
  pageMetadata,
  SERVICE_AREAS,
} from "../../lib/seo";

export const metadata = pageMetadata({
  title: "Used Cars near Havelock & Eastern NC",
  description:
    "Visit Drive Max in New Bern for used cars near Havelock, Jacksonville, Kinston, and Greenville. Explore inventory, financing options, and plan your visit.",
  path: "/areas-we-serve",
});

export default function AreasWeServe() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Areas we serve", path: "/areas-we-serve" },
            ]),
          ),
        }}
      />
      <section className="subpage-hero">
        <div className="container">
          <nav className="seo-breadcrumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Areas we serve</span>
          </nav>
          <span className="kicker kicker-on-dark">
            New Bern roots. Eastern NC neighbors.
          </span>
          <h1>Your used car search can start close to home.</h1>
          <p>
            Looking for used cars near Havelock, Jacksonville, Kinston, or
            Greenville? Drive Max welcomes you to our family-owned dealership in
            New Bern for quality vehicles and straightforward, personal service.
          </p>
        </div>
      </section>
      <section className="page-section">
        <div className="container">
          <div className="local-area-grid">
            <article className="local-area-card">
              <span className="kicker">One dealership. A warm welcome.</span>
              <h2>Based in New Bern, here for our neighbors.</h2>
              <p>
                We’re family owned and operated since 2019, right here at 6210
                Old US Hwy 70 West in New Bern. Whether you’re coming from
                Havelock, Jacksonville, Kinston, Dover, Cove City, Trent Woods,
                James City, or Greenville, our team is ready to help you find a
                vehicle that fits your life.
              </p>
              <p>
                Our team and vehicles are based at one location in New Bern. We
                welcome shoppers from these eastern North Carolina communities:
              </p>
              <ul
                className="service-area-list"
                aria-label="Communities we serve"
              >
                {SERVICE_AREAS.map((area) => (
                  <li key={area}>{area}, NC</li>
                ))}
              </ul>
            </article>
            <aside className="local-area-card local-visit-card">
              <MapPin size={30} aria-hidden="true" />
              <h2>Make the trip count.</h2>
              <address>
                Drive Max Used Cars LLC
                <br />
                6210 Old US Hwy 70 West
                <br />
                New Bern, NC 28562
              </address>
              <p>
                Check availability and arrange your visit before heading over.
                On a vehicle listing, choose “Request a test drive” to send us
                the specific car you have in mind.
              </p>
              <a
                className="button button-primary"
                href="https://www.google.com/maps/dir/?api=1&destination=6210+Old+US+Hwy+70+West+New+Bern+NC+28562"
                target="_blank"
                rel="noreferrer"
              >
                Get directions <ArrowRight size={18} aria-hidden="true" />
              </a>
              <Link className="text-link" href="/contact">
                Ask us about your visit →
              </Link>
            </aside>
          </div>
          <div className="local-shopping-grid">
            <article className="local-area-card">
              <h2>Shop before you drive.</h2>
              <p>
                Compare our current listings online, including photos, mileage,
                vehicle details, and pricing. Each listed total includes the
                $399 dealer administration fee; tax and tags are extra.
                Inventory is subject to prior sale, so ask us to confirm
                availability.
              </p>
              <Link className="text-link" href="/inventory">
                Browse used car inventory →
              </Link>
            </article>
            <article className="local-area-card">
              <h2>Talk through your options.</h2>
              <p>
                Have questions about financing or a vehicle you’d like to sell?
                Start online and our team will follow up with you. Financing is
                subject to lender approval and applicable terms.
              </p>
              <div className="local-text-links">
                <Link className="text-link" href="/apply">
                  Explore financing →
                </Link>
                <Link className="text-link" href="/sell-your-car">
                  Request a purchase offer →
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
