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
            Effective and last updated: October 31, 2026
          </p>
          <p>
            This policy covers drivemaxusedcars.com, inquiries submitted through
            this website, and our customer care messaging program. “We,” “us,”
            and “our” mean Drive Max Used Cars LLC in New Bern, North Carolina.
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

          <h2 id="website-analytics">Optional website analytics</h2>
          <p>
            With your permission, we use first-party analytics cookies to
            understand visits, vehicle interest, photo interactions,
            contact-button clicks, and inquiry starts. We record page paths and
            approximate active time, a general traffic source (such as Google or
            Facebook), and device type. We do not record form contents, full
            referring URLs, query strings, keystrokes, or screen recordings in
            analytics. We do not use device fingerprinting.
          </p>
          <p>
            A random browser identifier can recognize return visits for up to 90
            days. Visits are separated after 30 minutes without recorded
            activity. If you submit an inquiry or share your details through
            chat during a tracked visit, that visit can be linked to your CRM
            inquiry and its appointment or sale. A browser identifier is not
            proof of a person’s identity, and activity on different browsers is
            not automatically combined.
          </p>
          <p>
            Choose No thanks to use the website without optional analytics, or
            change your choice using Privacy choices at the bottom of the
            website. We also honor Global Privacy Control and Do Not Track
            signals for this analytics feature. Withdrawing permission stops new
            analytics and removes the browser identifier; previously recorded
            visits are retained for up to 180 days. You can contact us about
            deletion using the privacy request details below. Analytics is
            stored in our existing dealership database and accessible only to
            authorized staff.
          </p>

          <h2>Website chat</h2>
          <p>
            Our chat begins with a clearly labeled AI assistant. Chat messages
            are saved in our CRM and processed through Vercel AI Gateway and
            OpenAI to answer your questions. Authorized dealership staff can
            review the conversation and take over. A secure browser cookie lets
            you return to your conversation for up to seven days. Please do not
            send Social Security numbers, payment card details, passwords, or
            credit application documents in chat. You can ask for a staff member
            or call us instead. Contact details are saved for follow-up when you
            confirm the contact form; appointments are booked only after you
            confirm a time. Chat permission does not enroll you in text
            messaging.
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

          <h2 id="data-sharing">Data Sharing</h2>
          <ul>
            <li>
              <p>
                Customer data is not shared with 3rd parties for promotional or
                marketing purposes.
              </p>
            </li>
            <li>
              <p>
                Mobile opt-in and consent are never shared with anyone for any
                purpose. Any information sharing that may be mentioned elsewhere
                in this policy excludes mobile opt-in data.
              </p>
            </li>
          </ul>
          <p>
            Subject to the exclusions above, authorized dealership staff and
            service providers may process information needed to operate our
            services, including website hosting through Vercel, database and
            authentication services through Supabase, and email services through
            Resend and Namecheap Private Email. We may disclose information as
            needed to comply with law, protect people or property, or handle a
            business transfer subject to applicable privacy protections and the
            mobile opt-in and consent exclusions above.
          </p>
          <p>We do not sell website inquiry information.</p>

          <h2 id="messaging-program-terms">
            Messaging Program Terms and Conditions
          </h2>
          <ol>
            <li>
              <p>
                The messaging program consists of general customer care
                messaging to answer questions and provide support to customers.
                Messages will be sent from{" "}
                <a href="tel:+12525410040">(252) 541-0040</a>.
              </p>
            </li>
            <li>
              <p>
                You can cancel the SMS service at any time. Just text 'STOP' to
                the phone number from which you received messages. After you
                send the SMS message 'STOP' to us, we will send you an SMS
                message to confirm that you have been unsubscribed. After this,
                you will no longer receive SMS messages from us. If you want to
                join again, just sign up as you did the first time and we will
                start sending SMS messages to you again.
              </p>
            </li>
            <li>
              <p>
                If you are experiencing issues with the messaging program you
                can reply with the keyword HELP for more assistance, or you can
                get help directly at{" "}
                <a href="mailto:sales@drivemaxusedcars.com">
                  sales@drivemaxusedcars.com
                </a>
                .
              </p>
            </li>
            <li>
              <p>
                Carriers are not liable for delayed or undelivered messages.
              </p>
            </li>
            <li>
              <p>
                As always, message and data rates may apply for any messages
                sent to you from us and to us from you. Message frequency will
                vary based on communication needs. If you have any questions
                about your text plan or data plan, it is best to contact your
                wireless provider.
              </p>
            </li>
            <li>
              <p>
                If you have any questions regarding privacy, please read our
                privacy policy details contained in the rest of this page or
                contact us at{" "}
                <a href="mailto:sales@drivemaxusedcars.com">
                  sales@drivemaxusedcars.com
                </a>
              </p>
            </li>
          </ol>

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
