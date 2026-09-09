import { pageMetadata } from "../../lib/seo";
import Link from "next/link";
import BusinessHours from "../_components/BusinessHours";
import {
  ArrowRight,
  BadgeCheck,
  FileCheck2,
  HeartHandshake,
  ShieldCheck,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Family-Owned Used Car Dealer in New Bern",
  description:
    "Family owned and operated since 2019. Discover quality used vehicles, financing and warranty options, and personal service at Drive Max in New Bern, NC.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">
            Family owned & operated since 2019
          </span>
          <h1>Good cars. Good people. Right here in New Bern.</h1>
          <p>
            A smooth, transparent, and fun purchase experience, with people who
            care before, during, and after the sale.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="container story-grid">
          <div className="story-copy">
            <span className="kicker">Our story</span>
            <h2>Family owned. Community minded.</h2>
            <p>
              Drive Max Used Cars has been family owned and operated since 2019.
              We love connecting our New Bern neighbors with high-quality used
              vehicles and making the experience as enjoyable as the moment you
              get your keys.
            </p>
            <p>
              From your first question to life on the road, we believe in clear
              information, honest conversations, and customer service that
              continues long after the sale. We offer financing and warranty
              options, help you understand your choices, and handle the DMV
              paperwork so you can focus on your next vehicle.
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/inventory">
                Shop inventory <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="button button-secondary" href="/about/staff">
                Meet the staff
              </Link>
            </div>
          </div>
          <aside className="story-highlight purchase-promise">
            <span>The Drive Max promise</span>
            <strong>
              A little more peace of mind with your next set of keys.
            </strong>
            <ul>
              <li>
                <BadgeCheck aria-hidden="true" />
                <div>
                  <b>Passing state safety inspection</b>
                  <p>
                    Every vehicle we sell comes with a passing state safety
                    inspection.
                  </p>
                </div>
              </li>
              <li>
                <ShieldCheck aria-hidden="true" />
                <div>
                  <b>Free 14-day dealer warranty</b>
                  <p>
                    Included with every vehicle we sell. Ask us for the written
                    coverage, terms, and exclusions.
                  </p>
                </div>
              </li>
              <li>
                <FileCheck2 aria-hidden="true" />
                <div>
                  <b>DMV paperwork handled</b>
                  <p>
                    We take care of the paperwork and walk you through the next
                    steps.
                  </p>
                </div>
              </li>
            </ul>
          </aside>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <span className="kicker">Here for the whole journey</span>
            <h2>Service before, during, and after the sale.</h2>
          </div>
          <div className="values-grid">
            <article className="value-card">
              <span>01 / Before</span>
              <h3>Find your fit.</h3>
              <p>
                Tell us what you need, ask your questions, and explore quality
                used vehicles with a team that listens.
              </p>
            </article>
            <article className="value-card">
              <span>02 / During</span>
              <h3>Know your options.</h3>
              <p>
                Review the numbers, financing choices, and available warranty
                options with clear explanations and personal guidance.
              </p>
            </article>
            <article className="value-card">
              <span>03 / After</span>
              <h3>Keep in touch.</h3>
              <p>
                Questions about your purchase or what comes next? You have a
                direct line to people who are happy to help.
              </p>
            </article>
          </div>
          <p className="about-terms">
            Financing is subject to lender approval and applicable terms.
            Optional warranty coverage and pricing vary by vehicle and plan. Our
            included 14-day dealer warranty is subject to its written terms.
          </p>
          <Link className="text-link" href="/contact">
            <HeartHandshake aria-hidden="true" size={20} /> Get to know Drive
            Max <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </section>
      <section className="section">
        <div className="container about-visit-grid">
          <div>
            <span className="kicker">Come see us</span>
            <h2>A friendly welcome, on your schedule.</h2>
            <p>
              Visit our New Bern dealership Tuesday through Saturday during our
              regular hours, or arrange a Monday or Sunday appointment. We’re
              happy to help you plan a visit and confirm the vehicle you’d like
              to see.
            </p>
            <address>
              6210 Old US Hwy 70 West
              <br />
              New Bern, NC 28562
            </address>
            <Link
              className="button button-primary"
              href="/contact#contact-form"
            >
              Plan your visit <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
          <div className="about-hours-card">
            <BusinessHours headingLevel="h2" />
          </div>
        </div>
      </section>
    </>
  );
}
