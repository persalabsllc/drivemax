"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CONTACT_NOTICE_PARAGRAPHS,
  CONTACT_NOTICE_VERSION,
  SMS_CONSENT_LABELS,
  SMS_DISCLOSURE_INTRO,
  SMS_DISCLOSURE_TERMS,
  SMS_POLICY_URL,
} from "../../lib/contact-notice";

export default function ContactNotice({
  id,
  disabled = false,
}: {
  id: string;
  disabled?: boolean;
}) {
  const [choice, setChoice] = useState<"yes" | "no" | "">("");
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
      <fieldset
        className="sms-consent"
        disabled={disabled}
        aria-describedby={`${id}-choice-help ${id}-disclosure`}
      >
        <legend>
          Text message preferences <span>(optional)</span>
        </legend>
        <p id={`${id}-choice-help`}>
          Choose one. Leaving both unchecked means you have not agreed to texts.
          Use a mobile number above if you choose Yes.
        </p>
        {(["yes", "no"] as const).map((value) => (
          <label key={value} className="sms-consent-option">
            <input
              type="checkbox"
              name="smsConsent"
              value={value}
              checked={choice === value}
              onChange={(event) => setChoice(event.target.checked ? value : "")}
            />
            <span>{SMS_CONSENT_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>
      <div id={`${id}-disclosure`}>
        <p>{SMS_DISCLOSURE_INTRO}</p>
        <p>
          {SMS_DISCLOSURE_TERMS} Our combined Privacy Policy and Messaging Terms
          and Conditions are available at{" "}
          <Link href="/privacy-policy">{SMS_POLICY_URL}</Link>.
        </p>
      </div>
    </div>
  );
}
