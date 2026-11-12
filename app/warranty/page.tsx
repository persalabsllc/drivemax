import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  KeyRound,
  Paintbrush,
  Phone,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { pageMetadata } from "../../lib/seo";

export const metadata = pageMetadata({
  title: "Warranty & Vehicle Protection in New Bern, NC",
  description:
    "Every Drive Max vehicle includes a 14-day or 500-mile limited powertrain warranty. Explore optional service contracts up to 10 years, prepaid maintenance and more.",
  path: "/warranty",
});

const extras = [
  {
    icon: Wrench,
    title: "Prepaid maintenance",
    tagline: "Keep the good miles coming.",
    description:
      "Plan ahead for oil and filter changes plus tire rotations, with up to $125 combined per covered visit.",
    detail:
      "Your selected number of visits and the agreement’s time and mileage limits apply.",
  },
  {
    icon: CircleDot,
    title: "Tire & wheel protection",
    tagline: "A little backup for a rough road.",
    description:
      "Help with eligible road-hazard damage from potholes, curbs and roadway debris, including unrepairable punctures and damaged wheels.",
    detail:
      "Covered repairs include authorized parts, labor, mounting and balancing. Normal tire wear is excluded.",
  },
  {
    icon: Sparkles,
    title: "Paintless dent repair",
    tagline: "Keep little dings from stealing the shine.",
    description:
      "Repair eligible dents and dings up to the size of a credit card using a paintless repair process.",
    detail:
      "Paint must be intact and the area accessible for paintless repair. Larger dents and repainting are excluded.",
  },
  {
    icon: Paintbrush,
    title: "Appearance protection",
    tagline: "Enjoy the inside. Love the outside.",
    description:
      "Protection for covered interior stains and tears, plus specified paint damage from fading, sun spots, acid rain, bird droppings and tree sap.",
    detail:
      "Eight years with unlimited mileage under the appearance agreement. Pre-existing damage and ordinary wear alone are excluded.",
  },
  {
    icon: KeyRound,
    title: "Key replacement",
    tagline: "Lost keys don’t have to ruin your day.",
    description:
      "Help replacing a lost, stolen or inoperable key or key fob, including covered cutting and programming.",
    detail:
      "Up to three replacement keys during the contract, with a maximum of two in any rolling 12 months.",
  },
];

const questions = [
  {
    question: "What comes with every vehicle?",
    answer:
      "Every vehicle we sell includes our complimentary limited powertrain warranty. It begins at delivery and ends after 14 calendar days or 500 additional miles, whichever comes first. It covers mechanical failure of internally lubricated, moving components inside the engine or transmission, with 100% of covered parts and labor paid and no deductible. Read the written warranty for its complete coverage and exclusions.",
  },
  {
    question: "Can I get up to 10 years of coverage?",
    answer:
      "Ask us about optional vehicle service contracts with terms up to 120 months (10 years), subject to vehicle and plan eligibility. Each contract has a selected mileage allowance, deductible and total repair-benefit limit. Mechanical coverage ends at the expiration date or expiration mileage, whichever comes first. Ten years is the maximum available term, not a promise that every vehicle qualifies or that mileage is unlimited. Other protection products have their own terms; appearance protection is eight years.",
  },
  {
    question: "Is this bumper-to-bumper coverage?",
    answer:
      "Our included warranty and current Deluxe and Platinum service contracts cover specifically listed components. Platinum adds listed engine accessories and sensors to Deluxe powertrain coverage; it does not cover every vehicle system. A/C, steering, suspension and other unlisted components are excluded. We’ll show you the covered-component list and exclusions before you choose a plan.",
  },
  {
    question: "Do I have to buy an optional plan?",
    answer:
      "No. Service contracts, prepaid maintenance and the other protection products are optional, cost extra and are not required to buy a vehicle or obtain financing. Choosing or declining them does not change your included dealer warranty. We’ll review the coverage, price, deductible and limits with you so you can decide what fits.",
  },
  {
    question: "What should I do if I need a repair?",
    answer:
      "Contact Drive Max at (252) 541-0040 with your VIN, current mileage, symptoms and contract number if applicable, before authorizing repairs or teardown. We’ll help arrange the next steps under your coverage. Stop driving if continued use could worsen damage, and keep your maintenance and repair records. Follow the claim instructions in your written warranty or service agreement.",
  },
];

export default function WarrantyPage() {
  return (
    <>
      <section className="subpage-hero warranty-hero">
        <div className="container warranty-hero-grid">
          <div>
            <span className="kicker kicker-on-dark">Warranty & protection</span>
            <h1>
              Drive home with <em>peace of mind.</em>
            </h1>
            <p>
              Every Drive Max vehicle comes with a limited powertrain warranty.
              Want protection for more of the road ahead? Explore optional
              service contracts, prepaid maintenance and everyday protection.
            </p>
            <div className="button-row">
              <a className="button button-primary" href="#included-warranty">
                See what’s included <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="button button-ghost" href="#optional-protection">
                Explore optional plans
              </a>
            </div>
          </div>
          <aside
            className="warranty-included-card"
            aria-label="Included dealer warranty at a glance"
          >
            <div className="warranty-card-label">
              <ShieldCheck size={27} aria-hidden="true" />
              <span>Included with every vehicle</span>
            </div>
            <div className="warranty-duration">
              <strong>
                14 <span>days</span>
              </strong>
              <span className="warranty-or">or</span>
              <strong>
                500 <span>miles</span>
              </strong>
            </div>
            <p className="warranty-first">
              Whichever comes first after delivery
            </p>
            <h2>Limited powertrain warranty</h2>
            <p>Covered internal engine & transmission components.</p>
            <div className="warranty-deductible">
              <Check size={19} aria-hidden="true" /> $0 deductible on covered
              repairs
            </div>
          </aside>
        </div>
      </section>

      <section
        className="section"
        id="included-warranty"
        aria-labelledby="included-heading"
      >
        <div className="container">
          <div className="section-heading warranty-section-heading">
            <span className="kicker">Your first miles, with us behind you</span>
            <h2 id="included-heading">
              A little coverage.
              <br />
              Included with the keys.
            </h2>
            <p>
              There’s no separate purchase for this protection. Every vehicle we
              sell includes our 14-day / 500-mile limited powertrain warranty.
            </p>
          </div>
          <div className="warranty-benefits">
            <article>
              <ShieldCheck aria-hidden="true" />
              <h3>Engine & transmission</h3>
              <p>
                Mechanical failure of internally lubricated, moving components
                inside the engine or transmission.
              </p>
            </article>
            <article>
              <BadgeCheck aria-hidden="true" />
              <h3>Covered parts & labor</h3>
              <p>
                We pay 100% of covered parts and labor, with no deductible,
                under the written warranty.
              </p>
            </article>
            <article>
              <Phone aria-hidden="true" />
              <h3>A team you can call</h3>
              <p>
                Tell us about a concern before authorizing repairs. We’ll
                arrange inspection and covered repairs.
              </p>
            </article>
          </div>
          <div className="warranty-terms-note">
            <div>
              <strong>Know your coverage.</strong>
              <p>
                Coverage starts at delivery and ends after 14 calendar days or
                500 additional miles, whichever comes first. Accessories, seals,
                gaskets, leaks, electrical components, sensors and routine
                maintenance are excluded. The written warranty explains the full
                terms.
              </p>
            </div>
            <a
              className="text-link"
              href="/coverage/drive-max-limited-powertrain-warranty.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText size={19} aria-hidden="true" /> Read the warranty (PDF)
            </a>
          </div>
        </div>
      </section>

      <section
        className="section warranty-optional"
        id="optional-protection"
        aria-labelledby="optional-heading"
      >
        <div className="container">
          <div className="warranty-optional-heading">
            <div className="section-heading warranty-section-heading">
              <span className="kicker">
                Drive Max Protection · optional service contracts
              </span>
              <h2 id="optional-heading">
                Protect your budget.
                <br />
                Plan for the miles ahead.
              </h2>
              <p>
                An unexpected covered repair can interrupt your plans. Choose
                mechanical protection that helps with eligible repair costs
                beyond your included dealer warranty.
              </p>
            </div>
            <div className="warranty-ten-years">
              <span>Terms up to</span>
              <strong>
                10 <span>years</span>
              </strong>
              <p>
                On eligible vehicles. Selected mileage limits apply; coverage
                ends at the date or mileage limit, whichever comes first.
              </p>
            </div>
          </div>
          <div className="warranty-plan-grid">
            <article className="warranty-plan">
              <span className="warranty-plan-label">Powertrain protection</span>
              <h3>Deluxe</h3>
              <p>Focus on the mechanical components that keep you moving.</p>
              <ul>
                <li>
                  <Check aria-hidden="true" /> Listed internal engine components
                </li>
                <li>
                  <Check aria-hidden="true" /> Listed transmission &
                  transfer-case components
                </li>
                <li>
                  <Check aria-hidden="true" /> Listed drive-axle & driveline
                  components
                </li>
              </ul>
            </article>
            <article className="warranty-plan warranty-plan-platinum">
              <span className="warranty-plan-label">
                Powertrain + engine accessories
              </span>
              <h3>Platinum</h3>
              <p>
                Build on Deluxe with additional listed components for more
                protection.
              </p>
              <ul>
                <li>
                  <Check aria-hidden="true" /> All Deluxe covered components
                </li>
                <li>
                  <Check aria-hidden="true" /> Listed accessories, including
                  alternator, starter & water pump
                </li>
                <li>
                  <Check aria-hidden="true" /> Listed fuel, ignition,
                  engine-control components & sensors
                </li>
              </ul>
            </article>
          </div>
          <p className="warranty-plan-details">
            Optional service contracts cost extra. Coverage is limited to the
            components listed in the selected agreement. Vehicle eligibility,
            term, mileage, deductible, total repair-benefit limit, exclusions
            and prior repair authorization apply. A/C, steering, suspension and
            other unlisted systems are excluded from these plans.
          </p>
          <Link className="button button-primary" href="/contact#contact-form">
            Let’s compare your options{" "}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="extras-heading">
        <div className="container">
          <div className="section-heading warranty-section-heading">
            <span className="kicker">More ways to care for your car</span>
            <h2 id="extras-heading">
              Life happens.
              <br />
              Have a plan for it.
            </h2>
            <p>
              Build a protection package around the way you drive. These
              optional products are available separately, each with its own
              price, benefits and terms.
            </p>
          </div>
          <div className="warranty-extra-grid">
            {extras.map(
              ({ icon: Icon, title, tagline, description, detail }) => (
                <article className="warranty-extra" key={title}>
                  <Icon size={28} aria-hidden="true" />
                  <h3>{title}</h3>
                  <strong>{tagline}</strong>
                  <p>{description}</p>
                  <small>{detail}</small>
                </article>
              ),
            )}
            <aside className="warranty-extra warranty-extra-cta">
              <ShieldCheck size={32} aria-hidden="true" />
              <h3>
                Your car.
                <br />
                Your priorities.
              </h3>
              <p>
                Tell us how long you plan to keep your car and what matters
                most. We’ll walk through the choices with you.
              </p>
              <Link
                className="button button-light"
                href="/contact#contact-form"
              >
                Talk protection <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </aside>
          </div>
        </div>
      </section>

      <section
        className="section section-muted"
        aria-labelledby="warranty-faq-heading"
      >
        <div className="container warranty-faq-grid">
          <div className="section-heading warranty-section-heading">
            <span className="kicker">Clear answers before you choose</span>
            <h2 id="warranty-faq-heading">
              Good questions.
              <br />
              Straight answers.
            </h2>
            <p>
              Understand what comes with your vehicle and what you can choose to
              add.
            </p>
          </div>
          <div className="warranty-faq">
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={20} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section warranty-bottom">
        <div className="container warranty-bottom-inner">
          <div>
            <span className="kicker kicker-on-dark">
              Here before, during & after the sale
            </span>
            <h2>
              Let’s find your car.
              <br />
              And your peace of mind.
            </h2>
            <p>
              We’ll explain your included warranty and review optional
              protection with you before you choose.
            </p>
          </div>
          <div className="warranty-bottom-actions">
            <Link className="button button-light" href="/inventory">
              Shop inventory <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className="button button-ghost" href="tel:+12525410040">
              <Phone size={18} aria-hidden="true" /> (252) 541-0040
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
