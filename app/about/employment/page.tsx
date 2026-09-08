import type { Metadata } from "next";
import { Check, Paperclip } from "lucide-react";
import LeadForm from "../../_components/LeadForm";

export const metadata: Metadata = {
  title: "Employment",
  description:
    "Share your employment interest with Drive Max Used Cars in New Bern, NC.",
  alternates: { canonical: "/about/employment" },
};

export default function EmploymentPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Work with Drive Max</span>
          <h1>Bring your talents to Drive Max.</h1>
          <p>
            We’re a family-owned dealership that values teamwork, clear
            communication, and taking care of people. If that sounds like your
            kind of workplace, introduce yourself.
          </p>
        </div>
      </section>
      <section className="page-section page-section-muted">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Employment interest</span>
            <h2>Tell us what you bring to the team.</h2>
            <p>
              This is a general expression of interest, not a posting for a
              specific open role or a guarantee of employment.
            </p>
            <ul className="feature-list">
              <li>
                <Check aria-hidden="true" />
                Share the role or area that interests you
              </li>
              <li>
                <Check aria-hidden="true" />
                Summarize relevant experience
              </li>
              <li>
                <Paperclip aria-hidden="true" />
                Attach a résumé in the email that opens
              </li>
            </ul>
          </div>
          <LeadForm kind="employment" />
        </div>
      </section>
    </>
  );
}
