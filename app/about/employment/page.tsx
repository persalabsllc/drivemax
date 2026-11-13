import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, MapPin } from "lucide-react";
import { pageMetadata } from "../../../lib/seo";
import { openPositions, positionPath } from "../../../lib/employment";
import "./employment.css";

export const metadata = pageMetadata({
  title: "Careers & Open Positions",
  description:
    "Explore open positions at Drive Max Used Cars in New Bern, NC. View responsibilities, compensation, and growth opportunities, then apply for a specific role.",
  path: "/about/employment",
});

export default function EmploymentPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Careers at Drive Max</span>
          <h1>Put people first. Build your future.</h1>
          <p>
            Join a family-owned dealership where customer service comes first,
            teamwork matters, and your effort makes a difference.
          </p>
        </div>
      </section>
      <section className="page-section page-section-muted">
        <div className="container careers-container">
          <div className="careers-heading">
            <div>
              <span className="kicker">Join our team</span>
              <h2>Open positions</h2>
            </div>
            <span className="careers-opening-count">
              {openPositions.length} open{" "}
              {openPositions.length === 1 ? "role" : "roles"}
            </span>
          </div>
          <div className="careers-list">
            {openPositions.map((position) => (
              <article
                key={position.slug}
                className="career-card"
                aria-labelledby={`${position.slug}-title`}
              >
                <div className="career-card-copy">
                  <h3 id={`${position.slug}-title`}>
                    <Link href={positionPath(position.slug)}>
                      {position.title}
                    </Link>
                  </h3>
                  <ul className="career-meta" aria-label="Position details">
                    <li>
                      <BriefcaseBusiness size={17} aria-hidden="true" />
                      {position.schedule}
                    </li>
                    <li>
                      <MapPin size={17} aria-hidden="true" />
                      {position.location}
                    </li>
                  </ul>
                  <p>{position.summary}</p>
                  <p className="career-growth">
                    Opportunity to advance to General Sales Manager.
                  </p>
                </div>
                <div className="career-card-action">
                  <span className="career-pay-label">
                    Estimated annual earnings
                  </span>
                  <strong>{position.earnings.replace(" per year", "")}</strong>
                  <p>
                    Commission + performance bonuses
                    <br />
                    Biweekly draw against commissions
                  </p>
                  <Link
                    href={positionPath(position.slug)}
                    className="button button-primary"
                  >
                    View position &amp; apply{" "}
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <p className="careers-note">
            Choose a position to see the full description and apply for that
            opening.
          </p>
        </div>
      </section>
    </>
  );
}
