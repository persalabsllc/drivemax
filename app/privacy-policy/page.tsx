import { pageMetadata } from "../../lib/seo";
import Link from "next/link";
import { CONTACT_NOTICE_PARAGRAPHS } from "../../lib/contact-notice";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How Drive Max Used Cars LLC uses website inquiry information, protects it, and handles your contact preferences and privacy requests.",
  path: "/privacy-policy",
});

export default function PrivacyPolicy() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Drive Max Used Cars LLC</span>
          <h1>Privacy Policy</h1>
          <p>How we handle your information and your choices.</p>
        </div>
      </section>
      <section className="page-section">
        <article className="container policy-copy">
          <p className="policy-updated">
            Effective and last updated: September 7, 2026
          </p>
          <p>
            This policy covers drivemaxusedcars.com and inquiries submitted
            through this website. “We,” “us,” and “our” mean Drive Max Used Cars
            LLC in New Bern, North Carolina.
          </p>

          <h2>Information we collect</h2>
          <p>
            We receive information you choose to provide, including your name,
            email address, phone number, ZIP code, preferred contact method,
            messages, appointment preferences, vehicle interests, and budget or
            planned down-payment range. Vehicle purchase-offer requests may
            include a VIN, mileage, make and model, condition, title and
            accident history, loan status, and asking price. Employment
            inquiries may include experience and a résumé if you email one to
            us.
          </p>
          <p>
            We retain inquiry conversations, emails, vehicle assignments, and
            staff follow-up notes in our customer-management system. Our website
            and service providers may also process IP addresses, browser and
            device information, pages requested, and request times for site
            operation, security, and troubleshooting. Abuse-prevention checks
            use hashed request identifiers.
          </p>

          <h2>How we use information</h2>
          <p>
            We use information to answer questions, arrange visits and test
            drives, discuss inventory or financing needs, evaluate vehicles
            offered for sale, consider employment inquiries, and maintain
            customer records. We also use it to operate and protect the website,
            prevent spam and fraud, resolve disputes, and meet legal
            obligations.
          </p>

          <h2>Calls, texts, email, and your choices</h2>
          {CONTACT_NOTICE_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p>
            Please tell us which contact methods you want to stop. We honor
            applicable opt-out requests; we may still retain records or send
            communications required by law. A website inquiry is not permission
            for unrelated third-party marketing.
          </p>

          <h2>When we share information</h2>
          <p>
            Authorized dealership staff and service providers may process
            information needed to operate our services, including website
            hosting through Vercel, database and authentication services through
            Supabase, and email services through Resend and Namecheap Private
            Email. We may disclose information as needed to comply with law,
            protect people or property, or handle a business transfer subject to
            applicable privacy protections.
          </p>
          <p>
            We do not sell website inquiry information or share mobile numbers
            or text-message consent records with third parties for their own
            marketing. This does not prevent operational service providers from
            processing information on our behalf.
          </p>

          <h2>Cookies, VIN tools, and other websites</h2>
          <p>
            Essential cookies support features such as staff sign-in. Hosting
            and embedded services may also process technical information. You
            can manage cookies through your browser, although disabling them may
            affect some features.
          </p>
          <p>
            Using VIN lookup sends the VIN to the National Highway Traffic
            Safety Administration (NHTSA) to retrieve vehicle data. Embedded
            Google Maps may receive technical information when loaded. Clicking
            a CARFAX report link sends the vehicle VIN to CARFAX. These services
            and other external links are subject to their own privacy policies;
            this policy does not control their practices.
          </p>

          <h2>Retention and security</h2>
          <p>
            We keep information as reasonably needed for the purposes described
            here, our business records, dispute resolution, and applicable legal
            requirements. Retention varies by record type and circumstances. We
            use reasonable technical and organizational safeguards, but no
            website, email service, or storage system can guarantee absolute
            security.
          </p>

          <h2>Privacy requests</h2>
          <p>
            You may ask about information you submitted, request a correction or
            deletion, or change your contact preferences by emailing{" "}
            <a href="mailto:sales@drivemaxusedcars.com">
              sales@drivemaxusedcars.com
            </a>{" "}
            or writing to the address below. We may need to verify your
            identity. We will address requests in accordance with applicable
            law; some records may need to be retained for legal, security, or
            legitimate business purposes.
          </p>

          <h2>Financing and sensitive information</h2>
          <p>
            Our website financing form is an initial inquiry, not a credit
            application, and submitting it does not authorize a credit check. Do
            not include Social Security numbers, payment-card details,
            bank-account numbers, passwords, or copies of identification in
            ordinary website forms or email. If you proceed with financing,
            additional disclosures and a separate financial privacy notice may
            apply. This website policy does not replace those notices.
          </p>

          <h2>Children and policy updates</h2>
          <p>
            This website is not directed to children under 13. If you believe a
            child has provided personal information, contact us so we can
            address it. We may update this policy as our services or
            requirements change. The date above identifies the current version;
            we will provide additional notice when required.
          </p>

          <h2>Contact us</h2>
          <address>
            Drive Max Used Cars LLC
            <br />
            6210 Old US Hwy 70 West
            <br />
            New Bern, NC 28562
            <br />
            <a href="mailto:sales@drivemaxusedcars.com">
              sales@drivemaxusedcars.com
            </a>
          </address>
          <Link className="text-link" href="/contact">
            Contact the dealership →
          </Link>
        </article>
      </section>
    </>
  );
}
