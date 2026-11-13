import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  MapPin,
  Paperclip,
} from "lucide-react";
import {
  findOpenPosition,
  openPositions,
  positionPath,
} from "../../../../lib/employment";
import { pageMetadata } from "../../../../lib/seo";
import LeadForm from "../../../_components/LeadForm";
import "../employment.css";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return openPositions.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const position = findOpenPosition((await params).slug);
  if (!position) notFound();
  return pageMetadata({
    title: `${position.title} Jobs in New Bern, NC`,
    description: `Apply for our full-time ${position.title} position at Drive Max Used Cars in New Bern. Estimated annual earnings of $24,000–$75,000 with an opportunity to grow into sales management.`,
    path: positionPath(position.slug),
  });
}

export default async function PositionPage({ params }: Props) {
  const position = findOpenPosition((await params).slug);
  if (!position) notFound();

  return (
    <>
      <section className="subpage-hero career-hero">
        <div className="container careers-container">
          <Link href="/about/employment" className="career-back-link">
            <ArrowLeft size={16} aria-hidden="true" /> All open positions
          </Link>
          <span className="kicker kicker-on-dark">We’re hiring</span>
          <h1>{position.title}</h1>
          <ul className="career-meta" aria-label="Position details">
            <li>
              <BriefcaseBusiness size={18} aria-hidden="true" />
              {position.schedule}
            </li>
            <li>
              <MapPin size={18} aria-hidden="true" />
              {position.location}
            </li>
          </ul>
          <div className="button-row">
            <a href="#apply" className="button button-light">
              Apply for this position{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <section className="page-section">
        <div className="container careers-container career-detail-grid">
          <div className="career-description">
            <section aria-labelledby="career-overview">
              <h2 id="career-overview">A sales role with a personal touch.</h2>
              <p>{position.overview}</p>
            </section>
            {position.responsibilities.map((group, index) => (
              <section
                key={group.title}
                aria-labelledby={`career-responsibilities-${index}`}
              >
                <h2 id={`career-responsibilities-${index}`}>{group.title}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
            <section aria-labelledby="career-qualifications">
              <h2 id="career-qualifications">What you’ll bring</h2>
              <ul>
                {position.qualifications.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
          <aside
            className="career-sidebar"
            aria-label="Compensation and growth"
          >
            <div className="career-pay-card">
              <span className="kicker">Pay &amp; schedule</span>
              <h2>{position.earnings}</h2>
              <span className="career-pay-label">
                Estimated total earnings · {position.schedule}
              </span>
              <p>{position.compensation}</p>
              <a href="#apply" className="button button-primary">
                Apply for this position{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <div className="career-growth-card">
              <span className="kicker">Room to grow</span>
              <h2>Your next step could be leadership.</h2>
              <p>{position.advancement}</p>
            </div>
          </aside>
        </div>
      </section>
      <section
        id="apply"
        className="page-section page-section-muted career-application"
        aria-labelledby="career-apply-title"
      >
        <div className="container careers-container content-split">
          <div className="career-application-intro">
            <span className="kicker">Apply for this position</span>
            <h2 id="career-apply-title">Let’s get to know you.</h2>
            <p>
              Tell us about your experience, why you’d be a good fit, and when
              you could start.
            </p>
            <p>
              Your application will be addressed to the Drive Max team for the{" "}
              <strong>{position.title}</strong> opening.
            </p>
            <div className="career-email-note">
              <Paperclip size={21} aria-hidden="true" />
              <p>
                The form prepares an email in your email app. You can attach a
                résumé, review your application, and press Send to finish.
              </p>
            </div>
          </div>
          <LeadForm kind="employment" employmentPosition={position.title} />
        </div>
      </section>
    </>
  );
}
