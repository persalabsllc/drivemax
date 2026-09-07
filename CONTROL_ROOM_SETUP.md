# Drive Max Control Room — activation

This branch is an integration-ready implementation, not an activated production CRM. Existing mailto forms remain in place until enabled. No sample cars, customers, or staff passwords are included.

## 1. Dedicated Supabase project

In the Drive Max Vercel project's Storage screen, choose **Create Database → Supabase** and connect a dedicated project (suggested name: `drivemax`). Do not connect stores belonging to other applications. Review any provider pricing before accepting a plan.

Apply `supabase/migrations/202609070001_control_room.sql` once through that project's SQL editor or migration workflow. It creates inventory, leads, messages, staff, upload records, durable rate limits, and the public vehicle-photo bucket. The schema denies browser access to business tables; all application access is through authorized server code.

Set these variables on the Drive Max Vercel project. The integration may supply older key names; map their values to the names the application expects:

- `NEXT_PUBLIC_SUPABASE_URL`: project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (the legacy anon key also works).
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret/service-role key, server only.
- `LEAD_RATE_LIMIT_SECRET`: randomly generated 32-byte secret, server only.
- `CONTROL_ROOM_ENABLED=true`: set only after the schema and first staff account exist.

Keep Preview and Production on separate Supabase projects when testing. Do not post credentials in chat or GitHub. Pull configured variables through the normal Vercel environment workflow for authorized local integration testing.

## 2. Staff sign-in

Create the first owner in **Supabase Authentication → Users → Add user → Create new user**, using the owner's chosen email address and password. Enter the password only in Supabase's account form, never in SQL or source files. Enable **Auto Confirm User** for this owner-created account. Disable public signups.

The website uses Supabase email/password sign-in, followed by a server-side active-staff check. No email-code template or outbound email provider is required to sign in. Configure production SMTP if you later enable recovery/invitation email. Password recovery currently uses the Supabase administrator workflow; there is no public password-reset screen in this version.

After creating the Auth user, add its ID to `public.staff`:

```sql
insert into public.staff (id, email, name, role)
values ('AUTH_USER_UUID', 'owner-email@example.com', 'Owner name', 'owner');
```

Use the exact lowercased Auth email. Staff access requires both a confirmed Supabase Auth user and an active `staff` row; a public signup alone never grants access. Create additional Auth users and staff rows in the same way. Set `active=false` to revoke application access immediately. The initial version does not include an in-app staff invitation screen.

Staff enter at `/control-room` or the **Staff login** footer link and enter their email address and password.

## 3. Dealership email

Connect the Drive Max Resend resource to the Vercel project and finish verifying `drivemaxusedcars.com` for sending. Configure these server environment variables:

- `RESEND_API_KEY`: an appropriate key with send and received-email access.
- `RESEND_WEBHOOK_SECRET`: signing secret for the webhook below.

The public email addresses are configured in `lib/email-config.ts`:

- Sender: `Drive Max <sales@drivemaxusedcars.com>`.
- Reply domain: `uemoridela.resend.app`, the receiving domain supplied by the Drive Max Resend account.

The Resend-managed reply domain accepts `lead+UUID@uemoridela.resend.app` without registering another custom domain or adding receiving DNS records. Namecheap handles the dealership's normal inboxes. Keep receiving disabled on the root domain in Resend.

`LEAD_EMAIL_FROM` and `LEAD_REPLY_DOMAIN` remain optional environment overrides. A blank override uses the configured default. If changing Resend accounts, use the receiving domain supplied by the new account; if using a branded receiving subdomain later, verify it under a plan that supports it and configure MX on that subdomain.

Register `/api/email/webhook` in Resend for `email.received`, `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed`, and `email.failed`. The webhook URL must point to a publicly reachable deployment of the Control Room code. A preview behind Vercel sign-in cannot receive provider callbacks without an approved automation bypass. Save the signing secret in `RESEND_WEBHOOK_SECRET`, redeploy, and test a full send-and-reply conversation before considering the connection active.

Replies sent from the CRM use a unique `lead+UUID@reply-domain` address. Replies from the matching customer's email are appended to that lead. Unrelated inbound mail is ignored. Email HTML and attachments are not displayed in the CRM; plain text is stored. Direct mail to the dealership's existing mailbox and SMS are not automatically imported. Calls/texts can be logged as internal notes. Employment/resume inquiries retain their existing email-app flow.

## 4. Before production activation

Run `npm ci`, `npm test`, and `npm run build`. These verify compilation, validation, sold filtering, reply routing, and the migration against embedded Postgres. They do not prove live Supabase Auth, storage, or email delivery.

On a dedicated staging project, verify these flows with dealership-controlled test accounts:

1. Staff password sign-in succeeds; incorrect passwords and unknown/inactive accounts cannot access private pages, actions, or uploads. Sign-out and session refresh work. Confirm passwords are never returned in responses or stored in business tables.
2. Save a draft, upload actual photos, reorder them, publish, reload, and confirm persistence from a second session. Verify concurrent edits produce a reload warning.
3. Featured available vehicle appears on the homepage and search. Mark it sold: it disappears from those surfaces, remains below available inventory, and retains the same detail URL and sitemap entry. Check metadata and sold structured data.
4. Submit a contact, financing, and vehicle inquiry. Confirm each appears once, retrying the same submission does not duplicate it, and unsuccessful submissions never show success.
5. Assign a lead, set a follow-up, save a note, and send an email to a dealership-controlled test mailbox. Reply and verify the inbound message appears in the correct lead. Verify delivery events and failed-send retry with the same message ID.
6. Review mobile layouts and keyboard interaction. Confirm no private CRM content is returned when logged out and no server key appears in client assets.

Only promote the branch after activation checks pass. No production database migrations or real emails were run during code authoring.

## Daily use

Inventory: add vehicle → save draft → add photos → fill description/features/financing → choose available → save. First photo is the cover. Marking sold preserves the detail URL; archiving hides the listing. Removed photos are detached from listings but retained in storage for recovery; periodic asset cleanup is a separate administrative operation.

Lead inbox: select customer → update stage/assignee/follow-up → add internal note or email reply. Follow-up dates use the operator's local time; list timestamps are labeled Eastern time. Follow-ups are an in-app queue, not automatic scheduled emails. Leads retain their own customer contact snapshots; this is a lightweight dealership CRM, not a lender credit application or a full DMS integration.

Google may discover and index sold detail pages, but indexing or improved rankings are not guaranteed.

References: [Supabase on Vercel](https://vercel.com/marketplace/supabase), [Supabase SSR auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Resend receiving](https://resend.com/docs/api-reference/emails/retrieve-received-email), [Webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
