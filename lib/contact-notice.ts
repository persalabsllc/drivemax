export const CONTACT_NOTICE_VERSION = "2026-09-07-inquiry-v1";
export const CONTACT_NOTICE_PARAGRAPHS = [
  "By submitting this request, you authorize Drive Max Used Cars LLC to contact you by call, text message, or email at the information you provide about this inquiry and related follow-up, unless you opt out. We’ll use your preferred contact method when practical.",
  "Message frequency varies; message and data rates may apply. To opt out, tell our team, email sales@drivemaxusedcars.com, or reply STOP to a text you receive. Consent is not a condition of purchasing a vehicle. This request does not enroll you in recurring automated marketing calls or texts.",
] as const;
export const CONTACT_NOTICE_TEXT = CONTACT_NOTICE_PARAGRAPHS.join(" ");

export const contactNoticeKeys = [
  "contactNoticeVersion",
  "contactNoticeText",
  "contactNoticeSubmittedAt",
] as const;

// This records the notice accompanying an inquiry, not marketing opt-in.
// Older clients may submit without this version; do not backfill consent.
export function captureContactNotice(
  payload: Record<string, unknown>,
  submittedAt: string,
): Record<string, unknown> {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !contactNoticeKeys.some((noticeKey) => noticeKey === key),
    ),
  );
  if (payload.contactNoticeVersion !== CONTACT_NOTICE_VERSION) return clean;
  return {
    ...clean,
    contactNoticeVersion: CONTACT_NOTICE_VERSION,
    contactNoticeText: CONTACT_NOTICE_TEXT,
    contactNoticeSubmittedAt: submittedAt,
  };
}
