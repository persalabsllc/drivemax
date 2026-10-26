# Drive Max Used Cars

Production website for Drive Max Used Cars in New Bern, NC.

Vercel project: `drivemaxusedcars`

## CRM email connection

The website remains the email transport for both Control Room and CRM. Configure the same server-only `CRM_EMAIL_WORKER_SECRET` on both production Vercel projects. Existing `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `LEAD_EMAIL_FROM` and `LEAD_REPLY_DOMAIN` remain on the website. `/api/crm/email` checks the shared secret and claims immutable jobs from the shared database; it accepts only a message ID, never arbitrary email content. Preview deployments do not send CRM mail.

Deploy CRM migration `014_email.sql` before this website release. Enable the existing `/api/email/webhook` subscription for received, delivered, bounced, failed, suppressed and complained email. Production builds perform a read-only check of the verified dealership sender, webhook state and receiving API access. They do not send test emails.

Website lead submission dispatches the initial acknowledgment only after successful CRM import; existing notification delivery continues independently. CRM attention refresh and the existing daily notification cron recover pending sends with bounded retries. Resend requests use a stable message idempotency key; accepted provider IDs survive database retries. Stale work is failed before the provider's 24-hour idempotency window expires. Delivery failures are visible in CRM.

CRM emails use random `crm+<token>` reply addresses on the existing managed receiving domain. Control Room emails now use `lead+<lead-id>` reply addresses. The signed webhook retrieves the original received message and checks sender and route before storing plain text. HTML is converted without loading remote content; attachment presence is noted but attachments are not imported. Matched Control Room conversations also appear in CRM. This does not import mail sent directly to the dealership's normal mailbox. Bounces, complaints, suppression and manual customer opt-outs are respected by both sending screens.
