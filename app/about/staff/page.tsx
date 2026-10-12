import { pageMetadata } from "../../../lib/seo";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CarFront,
  Mail,
  ReceiptText,
  Sparkles,
  Wrench,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Meet the staff",
  description:
    "Meet Kyle Kratoville, General Manager at Drive Max Used Cars in New Bern, and get to know the people behind your dealership experience.",
  path: "/about/staff",
});

// Add individual profiles to the remaining departments as they are provided.
const departments = [
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
      <section className="section" aria-labelledby="management-heading">
        <div className="container">
          <div className="section-heading">
            <span className="kicker">Here to help</span>
            <h2 id="management-heading">Management</h2>
          </div>
          <article className="staff-profile" aria-labelledby="kyle-name">
            <Image
              className="staff-profile-photo"
              src="/staff/kyle-kratoville.webp"
              alt="Kyle Kratoville wearing a Drive Max Used Cars polo"
              width={800}
              height={800}
              sizes="(max-width: 760px) calc(100vw - 88px), (max-width: 1200px) 40vw, 440px"
            />
            <div className="staff-profile-details">
              <p className="staff-profile-title">General Manager</p>
              <h3 id="kyle-name">Kyle Kratoville</h3>
              <a
                className="staff-profile-email"
                href="mailto:kyle@drivemaxusedcars.com"
              >
                <Mail size={19} aria-hidden="true" />
                <span>kyle@drivemaxusedcars.com</span>
              </a>
              <div className="staff-profile-bio">
                <p>
                  Born and raised on Long Island, New York, Kyle made New Bern
                  home on July 4, 2012. He still jokes that the city’s fireworks
                  were a welcome party just for him. With 14 years in the car
                  business, he loves every part of it, especially meeting new
                  people.
                </p>
                <p>
                  Outside the dealership, Kyle enjoys boating on the Neuse
                  River, getting on the air as a ham radio operator, and
                  tending to his fish tanks. At home, two dogs and a cat help
                  keep life interesting.
                </p>
                <p className="staff-profile-invitation">
                  Have a question about buying, selling, or leasing a vehicle?
                  Want to share your experience with Drive Max Used Cars? Give
                  Kyle a call or send him an email. He’s always happy to help.
                </p>
              </div>
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
