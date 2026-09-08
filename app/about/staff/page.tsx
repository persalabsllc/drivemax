import { pageMetadata } from "../../../lib/seo";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  CarFront,
  Mail,
  Phone,
  ReceiptText,
  Sparkles,
  Wrench,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Meet the staff",
  description:
    "Meet owner Kyle Kratoville and get to know the roles behind Drive Max Used Cars in New Bern. Reach Kyle directly with questions about Drive Max or the car business.",
  path: "/about/staff",
});

// Add individual staff profiles and approved photos as they are provided.
const departments = [
  {
    title: "Management",
    label: "Keeping things moving",
    icon: BriefcaseBusiness,
    description:
      "Guidance through the purchase process, help understanding your options, and a direct point of contact for questions or concerns.",
  },
  {
    title: "Sales staff",
    label: "Finding your next vehicle",
    icon: CarFront,
    description:
      "Vehicle questions, test drives, and help finding the right fit for your needs and budget.",
  },
  {
    title: "Mechanics",
    label: "Care under the hood",
    icon: Wrench,
    description:
      "Vehicle preparation, maintenance, and repair work that help keep the focus on quality.",
  },
  {
    title: "Detail technicians",
    label: "The finishing touches",
    icon: Sparkles,
    description:
      "Interior and exterior care, with attention to the details that make picking up your vehicle feel special.",
  },
  {
    title: "Accounting",
    label: "Taking care of the details",
    icon: ReceiptText,
    description:
      "Purchase records, billing questions, and coordination of the paperwork that keeps a transaction organized.",
  },
];

export default function StaffPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Meet the staff</span>
          <h1>People first. Always.</h1>
          <p>
            Get to know the people and the work behind your Drive Max
            experience.
          </p>
        </div>
      </section>
      <section className="section page-section-muted">
        <div className="container">
          <article className="owner-profile">
            <div className="owner-intro">
              <div className="owner-monogram" aria-hidden="true">
                KK
              </div>
              <span className="kicker kicker-on-dark">Owner</span>
              <h2>Kyle Kratoville</h2>
              <p>Your neighbor in New Bern. Your direct line to Drive Max.</p>
              <div className="owner-contact">
                <a href="mailto:Kyle@drivemaxusedcars.com">
                  <Mail size={19} aria-hidden="true" />
                  <span>Kyle@drivemaxusedcars.com</span>
                </a>
                <a href="tel:+12525154389">
                  <Phone size={19} aria-hidden="true" />
                  <span>
                    252-515-4389 <small>Cell</small>
                  </span>
                </a>
              </div>
            </div>
            <div className="owner-bio">
              <span className="kicker">A note from Kyle</span>
              <h3>Cars brought me in. People made it home.</h3>
              <p>
                I started in the car business in 2012 because I loved cars and
                people. I worked my way up to Sales Manager at a franchise
                dealership, then decided to open my own dealership so I could
                create a warm, supportive work culture and serve the community I
                love: New Bern.
              </p>
              <p>
                At Drive Max, I want you to feel comfortable asking questions
                and confident in the people helping you. Buying a vehicle should
                be a smooth, transparent, and fun experience, and our
                relationship should continue well beyond the sale.
              </p>
              <p>
                When I’m away from the dealership, I enjoy boating, hiking, and
                playing with my dogs, Jace and Tucker.
              </p>
              <p className="owner-invitation">
                I’m always available to help with questions or concerns about
                Drive Max or the car business, whether you’ve bought a vehicle
                from me or not. Please reach out anytime.
              </p>
            </div>
          </article>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="section-heading">
            <span className="kicker">Every detail matters</span>
            <h2>The work behind your next set of keys.</h2>
            <p>
              From your first conversation to the finishing touches, these are
              the roles that support your experience.
            </p>
          </div>
          <div className="staff-departments">
            {departments.map(({ title, label, icon: Icon, description }) => (
              <article className="staff-department" key={title}>
                <div className="staff-role-icon">
                  <Icon aria-hidden="true" size={27} />
                </div>
                <span className="kicker">{label}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <div className="staff-join">
            <div>
              <h2>Good people make the difference.</h2>
              <p>
                Interested in bringing your skills to Drive Max? We’d love to
                hear from you.
              </p>
            </div>
            <Link href="/about/employment" className="button button-secondary">
              Explore employment <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
