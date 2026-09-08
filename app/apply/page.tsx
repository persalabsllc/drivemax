import { pageMetadata } from "../../lib/seo";
import {
  BadgeDollarSign,
  Check,
  FileText,
  MessageSquareText,
} from "lucide-react";
import LeadForm from "../_components/ConnectedLeadForm";

export const metadata = pageMetadata({
  title: "Used Car Financing in New Bern, NC",
  description:
    "Explore used car financing options at Drive Max in New Bern. Share your budget and vehicle needs to start a conversation. Subject to lender approval.",
  path: "/apply",
});

export default function FinancingPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Explore financing</span>
          <h1>A simple start to finding the right financing.</h1>
          <p>
            Tell us what you’re shopping for and how to reach you. This inquiry
            is not a credit application.
          </p>
        </div>
      </section>
      <section className="page-section page-section-muted">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Financing request</span>
            <h2>Tell us what you have in mind.</h2>
            <p>
              Share the type of vehicle you want, your planned down payment, and
              the best way to reach you.
            </p>
            <ul className="feature-list">
              <li>
                <Check aria-hidden="true" />
                Quick and easy first step
              </li>
              <li>
                <Check aria-hidden="true" />
                No commitment to purchase
              </li>
              <li>
                <Check aria-hidden="true" />
                Financing is subject to lender approval
              </li>
            </ul>
          </div>
          <LeadForm kind="finance" />
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="section-heading centered-heading">
            <span className="kicker">What happens next</span>
            <h2>A clear, three-step start.</h2>
          </div>
          <div className="steps-grid">
            <article className="step-card">
              <span className="step-number">01</span>
              <MessageSquareText aria-hidden="true" />
              <h3>Send your request</h3>
              <p>
                Share basic contact information and what kind of vehicle you
                have in mind.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">02</span>
              <BadgeDollarSign aria-hidden="true" />
              <h3>Discuss your options</h3>
              <p>
                Drive Max will follow up to learn more and walk through the
                available next steps.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">03</span>
              <FileText aria-hidden="true" />
              <h3>Complete an application</h3>
              <p>
                If you’re ready to move forward, we’ll guide you through the
                full credit application.
              </p>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
