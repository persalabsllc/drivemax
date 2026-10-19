// Public dealership addresses. Provider credentials remain in server environment variables.
export const dealershipEmail = "sales@drivemaxusedcars.com";

export function leadEmailFrom() {
  return (
    process.env.LEAD_EMAIL_FROM?.trim() ||
    "Drive Max <sales@drivemaxusedcars.com>"
  );
}

// Website alerts can use the existing mailbox without a Resend subscription.
export function notificationTransport() {
  if (process.env.SMTP_USER?.trim() && process.env.SMTP_PASSWORD)
    return "smtp" as const;
  if (process.env.RESEND_API_KEY?.trim()) return "resend" as const;
  return null;
}

export function leadReplyDomain() {
  return (
    process.env.LEAD_REPLY_DOMAIN?.trim().toLowerCase() ||
    "uemoridela.resend.app"
  );
}
