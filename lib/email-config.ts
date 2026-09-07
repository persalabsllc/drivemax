// Public dealership addresses. Provider credentials remain in server environment variables.
export function leadEmailFrom() {
  return (
    process.env.LEAD_EMAIL_FROM?.trim() ||
    "Drive Max <sales@drivemaxusedcars.com>"
  );
}

export function leadReplyDomain() {
  return (
    process.env.LEAD_REPLY_DOMAIN?.trim().toLowerCase() ||
    "uemoridela.resend.app"
  );
}
