import { pageMetadata } from "../../../lib/seo";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  CarFront,
  ReceiptText,
  Sparkles,
  Wrench,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Meet the staff",
  description:
    "Get to know the roles behind Drive Max Used Cars in New Bern, from management and sales to vehicle preparation and accounting.",
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
