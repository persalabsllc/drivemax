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

// Fictional department concepts. Keep the visible disclosure with these profiles.
const illustrativeProfiles = [
  {
    id: "sales",
    department: "Sales",
    name: "Alex Carter",
    role: "Sales Consultant",
    icon: CarFront,
    image: "/staff/alex-carter-illustrative.webp",
    bio:
      "Alex is a car enthusiast who enjoys weekend road trips and easy conversations. His approach is simple: listen first, answer questions clearly, and help shoppers find a vehicle that fits everyday life.",
  },
  {
    id: "accounting",
    department: "Accounting",
    name: "Morgan Ellis",
    role: "Accounting Coordinator",
    icon: ReceiptText,
    image: "/staff/morgan-ellis-illustrative.webp",
    bio:
      "Morgan likes a tidy spreadsheet almost as much as a good cup of coffee. A weekend gardener with a calm, friendly approach, she believes paperwork should feel straightforward and every question deserves a clear answer.",
  },
  {
    id: "detail",
    department: "Detail",
    name: "Jordan Bennett",
    role: "Detail Technician",
    icon: Sparkles,
    image: "/staff/jordan-bennett-illustrative.webp",
    bio:
      "Jordan enjoys bringing out the best in a vehicle, from clean glass to the finishing touches inside. A music lover and hands-on hobbyist, he takes pride in the little details that make a car feel ready for its next chapter.",
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
      <section
        className="section section-muted"
        aria-labelledby="departments-heading"
      >
        <div className="container">
          <div className="section-heading">
            <span className="kicker">Every detail matters</span>
            <h2 id="departments-heading">Explore our departments.</h2>
            <p>
              These three illustrative profiles use fictional names, bios, and
              AI-generated portraits to introduce each department. All emails
              reach the Drive Max team.
            </p>
          </div>
          <div className="staff-team-grid">
            {illustrativeProfiles.map(
              ({ id, department, name, role, icon: Icon, image, bio }) => (
                <article
                  className="staff-team-card"
                  key={id}
                  aria-labelledby={`${id}-name`}
                >
                  <div className="staff-team-category">
                    <Icon aria-hidden="true" size={22} />
                    <h3>{department}</h3>
                  </div>
                  <Image
                    className="staff-team-photo"
                    src={image}
                    alt={`AI-generated portrait of fictional ${department.toLowerCase()} profile ${name}, wearing a black Nike polo with the Drive Max logo`}
                    width={800}
                    height={800}
                    sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 980px) 46vw, 370px"
                  />
                  <div className="staff-team-content">
                    <h4 id={`${id}-name`}>{name}</h4>
                    <p className="staff-team-title">{role}</p>
                    <p className="staff-team-bio">{bio}</p>
                    <a
                      className="staff-profile-email"
                      href="mailto:sales@drivemaxusedcars.com"
                    >
                      <Mail size={19} aria-hidden="true" />
                      <span>sales@drivemaxusedcars.com</span>
                    </a>
                  </div>
                </article>
              ),
            )}
          </div>
          <article className="staff-department staff-mechanics">
            <div className="staff-role-icon">
              <Wrench aria-hidden="true" size={27} />
            </div>
            <div>
              <span className="kicker">Care under the hood</span>
              <h3>Mechanics</h3>
              <p>
                Vehicle preparation, maintenance, and repair work that help
                keep the focus on quality.
              </p>
            </div>
          </article>
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
