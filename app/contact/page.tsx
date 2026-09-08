import type { Metadata } from "next";
import { Mail, MapPin } from "lucide-react";
import LeadForm from "../_components/ConnectedLeadForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Drive Max Used Cars in New Bern, NC about inventory, financing, a visit, or an existing account.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Contact Drive Max</span>
          <h1>Ask before you make the drive.</h1>
          <p>
            Have a question about a vehicle, financing, a purchase, or an
            existing account? Send us the details and we’ll point you in the
            right direction.
          </p>
        </div>
      </section>
      <section className="page-section">
        <div className="container content-split content-split-wide">
          <div>
            <div className="contact-cards">
              <div className="info-card">
                <div className="info-card-icon">
                  <MapPin aria-hidden="true" />
                </div>
                <h2>Visit Drive Max</h2>
                <p>
                  6210 Old US Hwy 70 West
                  <br />
                  New Bern, NC 28562
                </p>
                <p>
                  <a
                    href="https://www.google.com/maps/dir/?api=1&destination=6210+Old+US+Hwy+70+West+New+Bern+NC+28562"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get directions
                  </a>
                </p>
              </div>
              <div className="info-card">
                <div className="info-card-icon">
                  <Mail aria-hidden="true" />
                </div>
                <h2>Email us</h2>
                <p>
                  <a href="mailto:sales@drivemaxusedcars.com">
                    sales@drivemaxusedcars.com
                  </a>
                </p>
                <p>
                  Our team is here to help before, during, and after your
                  purchase.
                </p>
              </div>
            </div>
            <div className="contact-map">
              <iframe
                title="Map showing Drive Max Used Cars in New Bern"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps?q=6210%20Old%20US%20Hwy%2070%20West%20New%20Bern%20NC%2028562&output=embed"
              />
            </div>
          </div>
          <div>
            <div className="content-intro content-intro-static">
              <span className="kicker">Send a message</span>
              <h2>How can we help?</h2>
              <p>
                Tell us what you need and the best way to reach you. We’ll take
                it from there.
              </p>
            </div>
            <LeadForm kind="contact" />
          </div>
        </div>
      </section>
    </>
  );
}
