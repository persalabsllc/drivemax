import Link from "next/link";
import {
  CONTACT_NOTICE_PARAGRAPHS,
  CONTACT_NOTICE_VERSION,
} from "../../lib/contact-notice";

export default function ContactNotice({ id }: { id: string }) {
  return (
    <div className="form-consent-note" id={id}>
      <input
        type="hidden"
        name="contactNoticeVersion"
        value={CONTACT_NOTICE_VERSION}
      />
      {CONTACT_NOTICE_PARAGRAPHS.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p>
        See our <Link href="/privacy-policy">Privacy Policy</Link> for how we
        use information and how to contact us about your choices.
      </p>
    </div>
  );
}
