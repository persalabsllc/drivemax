export const LEGACY_CONTACT_NOTICE_VERSION = "2026-09-07-inquiry-v1";
export const CONTACT_NOTICE_VERSION = "2026-10-20-sms-v2";
export const CONTACT_NOTICE_PARAGRAPHS = [
  "By submitting this request, you authorize Drive Max Used Cars LLC to contact you by phone call or email about your inquiry and related follow-up. We’ll use your preferred contact method when practical. We send customer care text messages only when you explicitly select Yes to texting consent on an inquiry form.",
  "You can decline texts and still submit your inquiry. To change your contact preferences, tell our team, email sales@drivemaxusedcars.com, or reply STOP to a text you receive. This request does not enroll you in recurring automated marketing calls or texts.",
] as const;
export const SMS_CONSENT_LABELS = {
  yes: "Yes, I consent to receive customer care messages from Drive Max Used Cars",
  no: "No, I do not want to receive any text messages from Drive Max Used Cars",
} as const;
export const SMS_DISCLOSURE_INTRO =
  "Drive Max Used Cars LLC (doing business as Drive Max Used Cars) would like your consent to send customer care text message communications from (252) 541-0040 to your mobile number listed above, in response to your questions or to provide information relevant to your relationship with us.";
export const SMS_DISCLOSURE_TERMS =
  "Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply 'STOP' to unsubscribe at any time. Reply 'HELP' for assistance or more information. We do not share your mobile opt-in information with anyone.";
export const SMS_POLICY_URL = "https://www.drivemaxusedcars.com/privacy-policy";
export const SMS_POLICY_TEXT = `Our combined Privacy Policy and Messaging Terms and Conditions are available at ${SMS_POLICY_URL}.`;
export const CONTACT_NOTICE_TEXT = [
  ...CONTACT_NOTICE_PARAGRAPHS,
  SMS_CONSENT_LABELS.yes,
  SMS_CONSENT_LABELS.no,
  SMS_DISCLOSURE_INTRO,
  SMS_DISCLOSURE_TERMS,
  SMS_POLICY_TEXT,
].join(" ");

export function smsConsentSummary(value: unknown) {
  if (value === "yes") return "Yes — customer care texts only";
  if (value === "no") return "No — do not send text messages";
  return "Not provided — do not send text messages";
}

export function smsPreferenceError(
  preferredContact: unknown,
  smsConsent: unknown,
  noticeVersion: unknown,
) {
  if (
    (smsConsent === "yes" || preferredContact === "Text message") &&
    noticeVersion !== CONTACT_NOTICE_VERSION
  )
    return "Please refresh this page to review the current texting consent before opting in.";
  if (preferredContact === "Text message" && smsConsent !== "yes")
    return "To receive a text reply, select Yes to customer care messages, or choose Email or Phone call as your preferred contact method. You can submit without agreeing to texts.";
  return null;
}

export const contactNoticeKeys = [
  "contactNoticeVersion",
  "contactNoticeText",
  "contactNoticeSubmittedAt",
  "smsConsent",
  "smsConsentText",
] as const;

// Only an explicit Yes on the current form grants customer care SMS consent.
// Missing choices and legacy inquiries never imply consent; always honor No.
export function captureContactNotice(
  payload: Record<string, unknown>,
  submittedAt: string,
): Record<string, unknown> {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !contactNoticeKeys.some((noticeKey) => noticeKey === key),
    ),
  );
  const current = payload.contactNoticeVersion === CONTACT_NOTICE_VERSION;
  const smsConsent =
    payload.smsConsent === "no"
      ? "no"
      : current && payload.smsConsent === "yes"
        ? "yes"
        : "not_provided";
  if (!current) return { ...clean, smsConsent };
  return {
    ...clean,
    smsConsent,
    smsConsentText:
      smsConsent === "not_provided"
        ? "No SMS consent was provided."
        : SMS_CONSENT_LABELS[smsConsent],
    contactNoticeVersion: CONTACT_NOTICE_VERSION,
    contactNoticeText: CONTACT_NOTICE_TEXT,
    contactNoticeSubmittedAt: submittedAt,
  };
}
