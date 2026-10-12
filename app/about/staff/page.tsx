import { pageMetadata } from "../../../lib/seo";
import { staffDepartments, type StaffProfile } from "../../../lib/staff";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  CarFront,
  Mail,
  ReceiptText,
  Sparkles,
  Wrench,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Meet the staff",
  description:
    "Explore the Sales, Management, Accounting, Detail, and Mechanics departments at Drive Max Used Cars in New Bern and find the right person to contact.",
  path: "/about/staff",
});

const departmentIcons = {
  sales: CarFront,
  management: BriefcaseBusiness,
  accounting: ReceiptText,
  detail: Sparkles,
  mechanics: Wrench,
};

function StaffCard({ profile }: { profile: StaffProfile }) {
  return (
    <article className="staff-team-card" aria-labelledby={profile.id + "-name"}>
      <Image
        className="staff-team-photo"
        src={profile.image}
        alt={profile.imageAlt}
        width={800}
        height={800}
        sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 980px) 46vw, 370px"
      />
      <div className="staff-team-content">
        <h3 id={profile.id + "-name"}>{profile.name}</h3>
        <p className="staff-team-title">{profile.role}</p>
        <div className="staff-team-bio">
          <p>{profile.bio[0]}</p>
          {profile.bio.length > 1 ? (
            <details className="staff-bio-more">
              <summary>More about {profile.firstName}</summary>
              <div>
                {profile.bio.slice(1).map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <a className="staff-profile-email" href={"mailto:" + profile.email}>
          <Mail size={19} aria-hidden="true" />
          <span>{profile.email}</span>
        </a>
      </div>
    </article>
  );
}

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

      <div className="staff-directory-overview">
        <div className="container">
          <nav className="staff-department-nav" aria-label="Staff departments">
            {staffDepartments.map((department) => (
              <a key={department.id} href={"#" + department.id}>
                {department.name}
              </a>
            ))}
          </nav>
          <p className="staff-directory-note">
            Alex Carter, Morgan Ellis, and Jordan Bennett are illustrative
            profiles with fictional names and bios and AI-generated portraits.
            All emails reach the Drive Max team.
          </p>
        </div>
      </div>

      {staffDepartments.map((department, index) => {
        const Icon = departmentIcons[department.id];

        return (
          <section
            className={
              "section staff-category-section" +
              (index % 2 === 0 ? " section-muted" : "")
            }
            id={department.id}
            aria-labelledby={department.id + "-heading"}
            key={department.id}
          >
            <div className="container">
              <div className="staff-category-header">
                <div className="staff-role-icon">
                  <Icon size={27} aria-hidden="true" />
                </div>
                <div>
                  <h2 id={department.id + "-heading"}>{department.name}</h2>
                  <p>{department.description}</p>
                </div>
              </div>
              {department.profiles.length > 0 ? (
                <div className="staff-team-grid">
                  {department.profiles.map((profile) => (
                    <StaffCard key={profile.id} profile={profile} />
                  ))}
                </div>
              ) : (
                <a
                  className="text-link"
                  href="mailto:sales@drivemaxusedcars.com"
                >
                  Contact our team about vehicle preparation
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
              )}
            </div>
          </section>
        );
      })}

      <section className="section staff-join-section">
        <div className="container">
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
