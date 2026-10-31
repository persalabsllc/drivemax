# Drive Max CRM

A standalone Next.js application for Drive Max customer management, showroom visits, follow-up planning, preliminary quotes, and manual trade worksheets. It uses the existing Vercel team and Supabase authentication service, with exclusively `dmcrm_*` business tables. The public website and Control Room application are not changed.

## Deployment boundaries

- Vercel project: `drive-max-crm` (`prj_mMh5v8DCSJBufyLSALIeHzfGAjE9`) in the existing Persa Labs team.
- Standalone source: this folder. It can move unchanged into its own repository root; then set Vercel Root Directory accordingly.
- Never merge this work into the website's `main` branch without review. No domain or website routing changes are required for the separate project.
- `/` requires a verified account, active CRM dealership membership, and an active linked CRM team record.
- `/demo` uses fictional, in-memory sample data. Demo mutations never reach the live API or persist in local storage.
- `/login` uses the existing Supabase identity provider, a separate cookie name, and local-scope sign-out. `/team-setup` accepts a one-use, 72-hour setup link issued by an authorized manager. Tokens are hashed in storage and carried in the URL fragment; no invitation email is sent automatically.
- Staff sessions end after 30 minutes without pointer, keyboard, or touch activity. A two-minute warning offers Stay signed in. Tabs share activity; background refreshes, status checks, page reloads, and focusing a tab do not extend the deadline. A signed, HttpOnly inactivity cookie is checked by every staff API through `session()`. Expired sessions require credentials again, including after sleep or offline use. Existing sessions need one fresh sign-in after this policy is deployed. The public demo and customer appointment links are unaffected.

- The new project has its own deployment settings and environment variables. Do not copy website email/cron settings.

## Setup

### Staff address

`crm.drivemaxusedcars.com` is assigned to this Vercel project for production. The authoritative nameservers are HostGator (`hgns1.hostgator.com`, `hgns2.hostgator.com`), so activation requires a CNAME record at HostGator: host `crm`, target `92ff748cd5f59b4d.vercel-dns-016.com`. This target was returned by Vercel for this project; re-check the domain configuration before future DNS changes. At setup on October 26, 2026, ownership was verified and DNS was still pending. Keep the current `drive-max-crm.vercel.app` address available until DNS and HTTPS have been checked.

The new host uses the same CRM project and database. Password sign-in, manager-issued setup links and API calls use the current host; session cookies have no parent-domain scope. No OAuth or emailed authentication callback is enabled. A new host requires a fresh sign-in with the existing CRM account. The login page directs staff into the live workspace; `/demo` remains a separate, explicitly labeled sample-data route for testing.

Settings provides staff access, dealership details, account-scoped exports and an explicit communication connection status. A workspace JSON export is not a database backup or a tested restore process; automatic backup retention and a restore drill still need verification with the database provider before treating exports as a recovery plan.

Use the committed lockfile with `npm ci`. Required variables are listed in `.env.example`. Only the Supabase URL and publishable key are public; the service role and database connection remain server-only. Never commit environment files.

`npm run build` applies pending numbered `db/*.sql` migrations only when `VERCEL_ENV=production`, under a transaction and advisory lock. Applied checksums are recorded in `dmcrm_schema_migrations`; modifying an applied migration fails the build. Existing installations are baselined at 001. Preview/local builds never migrate shared storage. The initial migration reads active owner identities from `public.staff` to seed CRM memberships. Migrations create or alter only CRM objects; existing website tables and identities are unchanged.

The initial workspace contains no real customer data. Existing website leads and inventory are not automatically imported.

## Working features

- Customer creation/editing/search; select an in-stock vehicle or enter a manual vehicle. Inventory includes stock number, VIN, decoded year/make/model/trim, mileage, color, acquisition date, cost, recon, retail price, and status. Days on hand are calculated in Eastern Time.
- Structured trade VIN, mileage, allowance, ACV, and payoff. A trade requires all five; zero payoff is accepted. Legacy free-text trades remain readable and are completed when edited.
- Authenticated NHTSA vPIC VIN decoding for inventory, manual vehicles, and trades, with a timeout, warning for partial results, and editable fallback. Only the VIN is sent to NHTSA. Demo decoding uses explicitly labeled sample fixtures; it does not call the live API.
- Per-customer notes and manual inbound/outbound call outcome history.
- Showroom check-in and prominent End visit actions in both profile and cards, Here/Left/Sold filters, and status color accents. Sold is independent from presence: a sold customer can still be here or have left. Ending an unsold visit preserves the record, keeps the customer unsold, and schedules follow-up.
- Daily, weekly and monthly planner; task completion; birthday and purchase-anniversary renewal on completion.
- Atomic sold transition cancels unsold follow-up and schedules 2/7/30-day follow-up plus annual reminder. Duplicate requests do not duplicate visits or sale tasks.
- Desking starts from inventory asking price and customer trade figures. Previously negotiated saved values persist when the vehicle/trade selection is unchanged. Saved proposals snapshot the vehicle and trade; inventory changes do not rewrite old versions. Cost and ACV remain internal and are excluded from customer printouts.
- **Desking → Quick quote** opens the same cash/finance calculator without a customer or vehicle requirement. Enter a manual price (optional description) or choose in-stock inventory. Fees, tax override, trade figures, F&I products and payment comparisons are available. Print uses the customer-safe quote layout; no Save/Send action or anonymous database draft exists. Leaving the screen, starting over or reloading clears the estimate.
- **Create customer & save quote** is the only persistence path for a quick quote. Migration `007_quick_quotes.sql` creates the profile, assigned opportunity and quoted figures atomically. Retry keys prevent duplicate profiles after a lost response. Inventory is validated at conversion and stays in stock. Unidentified trades retain their financial figures with “Trade details pending”; complete the trade details before closing a deal. Guest quotes are never sent.
- **Customer Desking → Build F&I menu** creates four named product packages using the selected cash or financing figures. Enter customer-facing names/descriptions, provider, term/mileage/deductible, internal cost and retail price; choose the products in each option or copy a previous saved menu. Save menu preserves the options without changing the deal. Applying an option (or declining all) replaces the deal products and saves a new quote version. Costs, internal notes and contract numbers are excluded from the landscape customer menu and portrait final acceptance. Acceptance lists accepted/declined coverage with blank signature lines; old versions retain their original selection, figures and customer names.
- Migration `008_fi_menus.sql` validates menu selections in normal and quick-conversion quote paths. Applying a package refreshes quote-derived shared/per-form paperwork overrides while retaining unrelated corrections. Bill-of-sale service contract, GAP, maintenance, tire/wheel and other-product lines reflect the selected products, and costs flow through existing accounting. Provider rating, contract issuance and electronic signatures are not integrated.
- Mark sold updates the linked CRM inventory vehicle to sold and the latest same-day visit to sold without changing its departure timestamp.
- Customer-facing quote printing and preliminary deal-summary checklist printing; browser Save as PDF supported.
- Customer opportunities preserve separate vehicles, trades, notes, proposals, and closed-deal snapshots for repeat purchases. Buyer/co-buyer identity and address fields and a separate insurance screen feed the print forms.
- Print sold pack offers 12 pages without a trade (no payoff sheet) or 16 with a trade (payoff plus separate trade MVR-180, MVR-181, and MVR-63). Shared and per-form corrections persist independently. MVR-2 remains a separate text-only overlay for preprinted stock. MVR-63 cannot be used when a lienholder holds the title; obtain the secure MVR-63A for that case.
- Settings manages salespeople and managers. Owners can manage managers; managers can manage salespeople. Existing login emails and owner access are protected. Setup links create new accounts or verify an existing password without changing other accounts.
- Opportunity assignment routes unsold/sold follow-up and purchase anniversaries. The newest active opportunity sets general customer ownership, including birthdays. Reassignment moves unfinished work; completed task attribution and closed sale snapshots remain intact. Deactivation requires a replacement and immediately revokes CRM access.
- Salespeople receive only their assigned tasks from the server; owners/managers receive the full team queue with filters. Customer profiles remain shared within the dealership. Verified email replies use this same routing and attention feed.
- Workspace JSON export (with the same task visibility as the signed-in user) and server-side mutation audit log.

## Customer appointments

- Schedule a timed appointment while creating a customer or from any existing profile, Overview, or Planner. New-customer creation and its optional appointment save in one database transaction.
- Types: test drive, return visit, vehicle viewing, sold delivery, service, trade appraisal, financing/paperwork, and other. Each appointment has an assigned active salesperson, date/time, 15–240 minute duration, and a brief description. Times are entered and displayed in Eastern Time regardless of the browser's timezone; skipped or ambiguous daylight-saving times are rejected.
- Overview shows upcoming appointments with customer, salesperson, time, type and description, with Today / Next 7 days / past unresolved and salesperson filters. Today includes recorded outcomes. Appointments also appear in the daily/weekly/monthly Planner and at the top of customer profiles, including closed appointment history.
- Appointments can be confirmed, rescheduled, marked arrived/completed/no-show, or canceled. Arrived also checks the customer into the showroom; completing an appointment does not end their showroom visit. Rescheduling clears a prior confirmation. Closed records remain read-only; schedule another appointment for another visit.
- Scheduling and every change write a readable customer activity and an immutable before/after audit entry. Revision checks prevent overwriting another session's edits. Overlapping bookings for the same salesperson show a warning and can still be saved intentionally.
- The team schedule is shared within the dealership. Salespeople can schedule and manage their own appointments; owners/managers can assign and manage anyone's. Appointments have independent assignments; deactivating a salesperson hands their open appointments to the selected replacement and retains completed attribution. Planner follows the existing owner filter and shows a salesperson's own appointments to that salesperson.
- Delivery/service appointments can reference sold opportunities. Appointment changes preserve deal status and other bookings. Enabled email workflows send confirmations, reschedules, cancellations, missed-visit invitations and reminders. Existing date-only appointment tasks remain intact; SMS and external calendar sync remain inactive. Customers can download an ICS calendar entry.

## Deal operations and accounting

- Customer/deal search combines active/lost/sold status, inclusive sold dates, salesperson, name/phone/email, vehicle/VIN/stock, and exact ZIP or a 10–500 mile radius. ZIP distances are straight-line estimates using the bundled Census reference, not road miles. Missing/unmapped ZIPs are excluded from radius results. The complete customer book is loaded in server batches and search results paginate in the UI.
- Migration 005 backfills an immutable sale ledger and trade intake from existing sold snapshots. New sales generate a trade stock number from the sold stock plus `A`; manual vehicles without stock use a unique `TR-…A` fallback. Trade intake supports updated miles, cost, recon, retail inventory and wholesale proceeds. Retail trades are counted only once in inventory valuation.
- Managers can unwind a sold opportunity with a required reason. The sale snapshot, original paperwork and commissions remain in history; the sold car returns to stock, the trade returns to the customer (retail copy archived), remaining sold follow-ups cancel, and an unsold follow-up is created. Another opportunity on the trade, a pending/sold retail trade or a completed wholesale sale blocks reversal. Reselling the original deal creates a separate sale record and fresh follow-ups; an eligible returned trade reuses its archived inventory identity.
- Desking records service contract, tire/wheel, GAP, paintless dent repair, appearance protection and prepaid maintenance with provider, contract number, term, mileage, deductible, cost and price. Product retail is counted once in quote totals. Unknown provider costs are explicit. Post-sale accounting cost overrides preserve the original customer proposal.
- Profiles show overdue, due today and upcoming tasks across all opportunities. Task dialogs open phone links or message composers, record call outcomes and allow manual completion. Drafting or opening a call never silently completes a task.
- Text and email threads persist across purchases, distinguish drafts/manual logs/delivery states, and support saved quote references. Drafts have revision checks and creator/manager edit permissions. Customer PDFs use an explicit allowlist that excludes costs, ACV and commission data; `/api/quotes/[id]/pdf` independently authenticates and scopes the quote/customer.
- Accounting has sold-deal profit, current inventory valuation/aging, F&I product profit, trade ACV/allowance, commission sheets, wholesale trade profit and unwind history. Reports support date ranges, salesperson/recipient filters, CSV and print. Internal deal recaps are printable from profiles and report rows. Accounting/trade actions require owner/manager access; salespeople receive only their own commission rows and no accounting snapshots.

### Accounting definitions

Front gross = selling price − vehicle cost − vehicle recon + accessories − accessory cost + doc fee + (trade ACV − allowance) − other direct costs. F&I gross = product retail − actual product costs + finance reserve. Total gross = front + F&I; net contribution = gross − entered earned commissions. Doc fees remain in dealership gross but are excluded from the front commission basis; pack also reduces that basis. Tax/title collections, down payments and trade payoff are settlement figures, not profit. Deal net excludes dealership overhead. Incomplete costs are labeled and excluded from aggregate gross/net rather than assumed to be zero. Wholesale proceeds minus trade cost/recon are reported separately.

New sold deals automatically create sales and F&I earnings for the snapshotted salesperson: 25% of positive commissionable front gross (front gross minus doc fee and pack), plus 5% of positive F&I gross including finance reserve. Missing costs are marked pending and excluded from earned totals. Default entries recalculate when accounting is saved; managers can change the recipient or choose a manual amount. Existing commission rows stay manual and retain their amounts; there is no historical backfill. Date filters select the original **sale date**. “Paid to date” is cumulative for those deals, with a last-paid date; it is not a cash-disbursement ledger for the selected payment period. Unwound earnings become zero while previously paid amounts remain as recovery balances. Previously paid entries cannot be deleted/reduced or reassigned. Accounting edits retain a before-image audit record and use revision checks.

### Email and follow-up

Migration `014_email.sql` connects CRM email to the website's existing Resend transport. In Settings → Email & follow-up, each active user edits only their own plain-text signature. Managers add, edit, and delete dealership templates and choose the automatic website acknowledgment. Thirteen editable starter templates cover the first response, days 1–6, sold thank-you, seven-day sold follow-up, six-month anniversary, birthday, test-drive scheduling and seller next steps. Personalization supports first/customer name, vehicle, salesperson, dealership, phone and website. Staff review manually composed messages before sending. Migration 015 adds editable future-event automations using the existing templates, plus appointment and annual purchase templates.

Customer profiles → Emails offers template selection, editable text, saved drafts, explicit Send email, reply, refresh, and an email preference control. Saved quote emails attach the customer PDF built on the server; internal costs, ACV and commissions never enter that attachment. Each draft is version checked before an immutable email payload is queued. Only the author or a manager can send it. Old drafts never send automatically. Each message has its own unguessable reply address at the existing managed receiving domain. Verified replies appear in Emails, Activity, Conversations and the existing Needs attention feed. Website Control Room email exchanges are also copied to the matching imported CRM profile. Direct mail to the ordinary sales mailbox and historical external inbox mail are not imported.

After a new website inquiry is durably imported, one initial acknowledgment is queued automatically. The workflow is enabled for future Drive Max inquiries at rollout, never for historical leads. No-email, opted-out and provider-suppressed recipients are skipped. Repeated inquiries from one address within ten minutes receive one acknowledgment. Managers can turn the workflow off or change its template/team signature in Settings. Website request completion dispatches the queue; CRM attention polling and the website's existing notification cron provide bounded retry recovery. Failed sends are visible for staff review, not silently retried forever.

Production requires the same server-only `CRM_EMAIL_WORKER_SECRET` on both Vercel projects. Provider credentials remain on the website: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and the existing sender/receiving-domain configuration. CRM calls only the fixed owned website `/api/crm/email` endpoint with its shared secret. Preview/demo deployments never send. Website webhook signatures, the managed reply domain, the random reply token and the original recipient are verified before attaching a reply. HTML-only messages are converted to plain text; attachments are noted but not fetched. Delivery events are idempotent and monotonic, including provider events that arrive before the send response is recorded. Bounces, complaints and suppression stop further email. Manual opt-out is checked when queued and again before sending.

Database functions and the private outbox are service-only. Claims use row locks, claim tokens and immutable provider idempotency keys; retries stop before the provider's 24-hour deduplication window expires. Production migrations exercise real draft/queue/claim/reply/workflow functions in a rollback-only savepoint; no verification leads or emails survive. SMS remains draft-only until separately connected.

## Access and tenant boundaries

Every read independently verifies the authenticated user and active CRM membership, then scopes all queries by the server-resolved dealership. Every mutation is schema-validated and passed to an atomic RPC that re-checks membership and validates cross-record tenant references. Anonymous/authenticated browser roles cannot access business tables or invoke the command RPC. Composite foreign keys reject cross-dealership references. POST requires a matching Origin. Only trusted server code has the service role key.

The foundation uses one active dealership per user in the UI. The database supports multiple dealerships, but self-service onboarding, organization switching, customer-level permissions, MFA enrollment UX, billing, backup/restore drills, large-book pagination, and production observability remain pre-commercial-launch work. Shared Supabase infrastructure and owner identities are still dependencies to separate when migrating to an independent hosting account.

## Explicitly not connected yet

SMS delivery/receipt, direct external mailbox import, telephony, two-way inventory synchronization, live book values, e-signatures, lender submissions, and regulated final contracts. Nothing is sent when a sample interaction is logged. Printed forms require review and signatures; condition attestations, signatures, and notarization are not filled automatically.

## Checks

- `npm run typecheck`
- `npm test` — quote calculations; Eastern dates; validation; demo transitions; actual PostgreSQL-compatible migration/RPC integration with PGlite, including cross-tenant and browser-role denials, visit deduplication, sale follow-up and anniversary behavior; team ownership/permissions, secure invitation claims and handoffs, and real 12/16-page sold packs with independent trade fields.
- `npm run build`

Manual acceptance: create customer → add note/call → check in → create quote → mark sold → confirm visit remains open → check out → confirm follow-up → reload and verify persistence. For inventory: add/decode VIN → select inventory in a customer → enter required trade values → verify desking price/cost/days/trade → save → end an unsold visit → confirm Left and retained visit → reload. Test the demo separately; a demo pass alone is not evidence of live backend integration.

## Staff accounts and contact details

Settings → Your team → Add user requires first name, last name, email, phone, street address, city, state, and ZIP (address line 2 is optional). Phone numbers are normalized with a country code for future notifications. Phone/address fields are excluded from salesperson workspace payloads and exports; they are visible to managers. Existing staff names are migrated without inventing missing contact information; complete those fields when editing a record.

Owners can add salespeople and managers; managers can add salespeople. Set an initial password of at least 12 characters to create a login immediately, or use the existing private setup-link flow. No email or SMS is sent. Dedicated CRM accounts expose Set password / Reset password to authorized managers, with an audit entry and no stored or retrievable plaintext password. Existing logins linked from another application retain their original password recovery; owners, self-management, cross-dealership identities, and Control Room accounts are protected. Newly created identities are linked atomically to CRM membership, and failed links clean up only identities confirmed unlinked. No existing user credentials are changed by deployment.


## Website lead intake

Migration `012_website_intake.sql` connects the public site's existing `submit_lead` transaction to the CRM in the shared Supabase database. Test-drive, sell-your-car, general contact, financing, and other vehicle inquiries create a Website opportunity, the original inquiry in Activity, and a due-today follow-up task. Employment applications stay in the website inbox. The intake itself needs no public form change or second submission endpoint.

Each website request ID is imported once. A normalized email/phone match reuses a customer only when exactly one profile matches and the full name agrees. Conflicting/shared contact details create a separate profile with an explicit review note. Existing profile details and sold deals are preserved. An active existing salesperson is retained; otherwise a linked website staff identity is used if available, with remaining inquiries unassigned in the owner/manager attention feed. Assign the opportunity through the normal salesperson selector.

The original server-captured vehicle snapshot is retained. Inventory is linked by VIN only when the CRM unit is available; website and CRM inventory IDs are independent. Requested test-drive times require staff confirmation. Seller vehicles remain appraisal inquiries, with condition, title, mileage, asking price and payoff information in Activity; they are not stock or trade inventory. Follow-up tasks use the preferred channel, with SMS selected only for explicit current customer-care consent. Requested appointments are not automatically confirmed. Future inquiries can receive the automatic email acknowledgment described above.

The private intake table retains source payloads and mapping IDs independently of later website edits. Imports run atomically inside a failure-isolated trigger. Failures keep the original website inquiry and notification queue intact, leave no partial CRM deal, and retry with bounded backoff during the existing 30-second CRM attention refresh. That refresh also recovers unqueued open inquiries in batches of 20. Owners/managers see a pending-import warning; applicants and closed historical website deals are excluded from backfill. Website request alerts have per-user review receipts, including requests from returning customers. Existing open website inquiries are imported on rollout/refresh.

Control Room status edits remain independent. Later email exchanges are bridged by migration 014; inventory synchronization is described below. Tests exercise both applications' actual SQL migrations and the website's `submit_lead` procedure. Production migrations additionally run contact, test-drive, seller and duplicate-retry fixtures within a savepoint and roll them back before committing; no test leads or notifications survive.

## CRM inventory → website drafts

Migration `013_inventory_website_sync.sql` connects inventory in the Drive Max CRM to the website Control Room using the shared database. Adding stock creates an unpublished website draft with VIN, stock number, year, make, model, trim, mileage, exterior color, and the initial asking price. Existing website VINs link to the same listing without duplicating the record or changing its URL. Current active CRM stock is backfilled in batches on rollout and normal refresh; historical sold units with no website listing are not newly advertised.

CRM Inventory now shows website status, online price, and an **Edit listing** link to the specific Control Room editor. Staff add photos, descriptions and features, choose the online price, and publish there. Online price is copied only when a new website listing is created: subsequent Control Room price changes are preserved, and later CRM asking-price edits do not overwrite them. Changed CRM identity/mileage/color fields continue to sync; unchanged fields do not undo website refinements. Acquisition cost, recon, deal details, commission data, and customer information are never copied into public website records. A zero-price CRM unit becomes a zero-price draft; Control Room requires a real price before publishing.

Sold CRM units become sold website listings if already published, otherwise archived. Removed or archived stock is archived on the website. Unwinding a sale returns a previously sold listing to draft for review before republishing, preserving photos and descriptions. A stale Control Room save cannot mark sold, removed, or pending CRM stock as available. Trades create drafts only after moving into retail inventory; wholesale/returned trades are withdrawn. Drafts are never automatically published.

The private mapping/outbox preserves CRM saves if a website write fails and retries during authenticated workspace/attention refresh. Missing or changed source snapshots are recovered. Stock/VIN collisions and details exceeding Control Room limits are shown as **Needs review** rather than overwriting unrelated vehicles or truncating data. After correcting CRM details, the next save retries immediately. Automatic retries use bounded backoff. The Inventory refresh button reloads current website status without introducing a second editing system.

Tests run the complete website/CRM SQL chain, authenticated inventory commands, actual sale/unwind/trade commands, conflicts, failure rollback/retry, draft publication rules, and access boundaries. Production migration also verifies draft creation, preserved website merchandising, sale visibility, unwind and deduplication inside a savepoint; all verification stock and listings are rolled back before commit. The existing website deployment needs no rebuild because its Control Room and public inventory already read these same records without caching.

### Work Today and automated sales workflows

Migrations 015–017 add an assigned work queue, future-event email/task steps, appointment customer links, buyer wish lists, sales stages and funnel reporting, inventory preparation/recon, delivery/funding tracking, private deal documents and optional browser push. No paid SMS provider is enabled.

- **Work Today:** unanswered messages, leads without personal outreach, past-due/due tasks, appointments needing an outcome, stale proposals, missing next actions and funding follow-up. Overview includes the first six actions. Customer-level replies appear once, with an active/recent opportunity.
- **Settings → Automated follow-up:** edit timing, event, email template or task, business hours and reply stopping. New opportunities receive days 1–6; unsold visits next-day follow-up; sold deals thank-you, seven-day and six-month messages; birthdays and purchase anniversaries run annually. A customer receives at most one new-lead/unsold-visit nurture email in a 20-hour period. Turning off a step or pausing a customer cancels pending work; resume applies to future events. Rules do not backfill old leads or sales. Existing future appointments receive reminders only.
- **Appointments:** scheduled/rescheduled/canceled/missed event emails, day-before and two-hour reminders, Eastern time. Rescheduling invalidates old links/reminders. Reply, sale, lost status, opt-out, suppression and appointment state are checked before queuing/claiming. Public UUID links show only appointment details; GET never confirms or unsubscribes. Reschedule requests create a task and inbound history.
- **Automation runtime:** existing Supabase pg_cron runs every five minutes; pg_net calls the CRM worker using a dedicated Vault-held secret. Existing website Resend transport retains immutable provider keys and bounded retries. No additional paid plan is provisioned. Scheduler and worker heartbeat are separate; `/api/health` exposes only readiness booleans/status. Cron and browser refresh do not send SMS.
- **Buyer wish lists:** requirements match available CRM inventory by price, miles, year, make and model; uncertain equipment is labeled for verification. Staff review prepared drafts before sending.
- **Sales reports:** opportunity-created cohorts by source, staff and vehicle, shows, closes, logged human first-response time, lost reasons and manager-only PVR/F&I penetration. Automated acknowledgments do not count as human response. Sold-date financial reports remain in Accounting. Historical milestones are not invented. CSV and isolated print views are available.
- **Inventory → Preparation:** owner, ready date, title, blockers, recon items and status. An explicit checkbox replaces the inventory recon total with the item sum; repeated saves do not add it twice. Sold cost snapshots remain unchanged.
- **Profile → Delivery:** stage, funding/lender/stipulations, secure application-provider link, delivery checklist and required-data review. Private signed PDFs/images can be uploaded up to 4 MB. Sold-pack printing optionally archives the exact generated PDF. Downloads require assigned salesperson or manager access and use short-lived URLs. This is document storage, not e-signing or lender submission.
- **Settings → Device notifications:** opt-in browser/home-screen push for new leads, replies and a daily task digest, with recipient permissions rechecked before delivery. Generic notification text contains no customer PII. On supported iPhones, add the CRM to the Home Screen and enable notifications from the installed app.

Verification: full TypeScript/build checks, 107 passing tests (run with `--test-concurrency=1` when the local WASM runtime cannot sustain parallel PGlite workers), browser interaction and print checks. Production migrations run rollback-only workflow fixtures and require an active five-minute scheduler before commit.


### Vehicle appraisal workspace

Appraisals automatically includes all opportunity trades, with completed/lost opportunities under History. Street and auction valuations can be created without a customer. Saved worksheets include VIN/vehicle/condition, dated staff-entered book values, separate asking/sold/wholesale comparables, recon line items and a cost/target-gross calculation. Drive Max comparables use completed (not unwound) sale snapshots and current inventory asking prices, matching make/model within three years. No invented book or market values are generated.

Migration `019_appraisals.sql` stores valuation revisions and actor attribution. Active staff can create standalone valuations; only their creator, the assigned salesperson or a manager can edit. Only managers approve and apply ACV. A linked trade must still be open and match the approved VIN, mileage, year, make, model and trim. Applying requires the latest appraisal revision and opportunity timestamp, updates only working trade ACV, and logs activity. Allowance, payoff, saved quote versions and completed sale accounting remain unchanged. Editing a saved valuation clears its approval. Archived standalone/open-deal appraisals can be restored by saving again.

KBB and J.D. Power buttons open public research pages. Their figures are recorded manually until licensed provider access is configured. No subscriptions are created by this release. An optional server-only `MARKETCHECK_API_KEY` enables a manager-initiated `/api/appraisals/market` search; it is never requested automatically. It uses the official US used inventory endpoint, exact year/make/model/trim, ZIP/radius, ten deduplicated retail asking listings, and strips credential-bearing links. Configure a licensed plan and provider usage limits before enabling the key. Retail listings are not sold prices or appraised trade values.

`tests/appraisals.test.ts` covers math, data provenance, SQL permissions/concurrency/closed deals and financial isolation. The production migration also runs `verify-appraisals.mjs` in a rolled-back savepoint before committing. Workspace REST verification includes the new table to prevent a schema/API mismatch from breaking sign-in.


## Facebook Page lead intake (October 27, 2026)

Migration `021_facebook_intake.sql` adds signed Page Messenger intake at
`https://crm.drivemaxusedcars.com/api/webhooks/facebook`. The first incoming
message from a Page-scoped sender creates a customer, Facebook opportunity and
follow-up task. Message IDs deduplicate webhook retries; later messages stay
with the same customer and opportunity. Exact VINs and `vehicle:<CRM inventory
UUID>` referral values can identify available stock. A different identified
vehicle gets a separate opportunity; existing closed deals are preserved.
Generic messages and ad IDs do not guess a vehicle. Facebook identity never
merges with a customer merely because the name matches.

Customer profiles have a Facebook tab, Activity includes incoming messages,
Conversations includes Facebook threads, and Needs attention follows the
opportunity's current salesperson assignment. Owners/managers see all such
alerts. Existing enabled browser push subscriptions receive Facebook alerts.
Replying still opens Meta Business Suite. No Facebook message or SMS is sent
by this integration, and a Facebook inquiry does not confer SMS consent.
Attachments are described in the thread and remain viewable in Meta; they are
not downloaded. Facebook does not necessarily provide a telephone number or
email. The initial identity label is updated with a name only if the optional
Meta profile lookup succeeds, and never overwrites a staff-edited name.

Production activation requires these server-only Vercel variables in the
**drive-max-crm** project: `FACEBOOK_PAGE_ID`, `FACEBOOK_APP_SECRET`, and a random
`FACEBOOK_VERIFY_TOKEN`. Optional `FACEBOOK_PAGE_ACCESS_TOKEN` allows profile
name lookup through Graph API v25.0, subject to Meta's approved profile access.
Use the same app secret as the Meta app receiving these webhook subscriptions.
Subscribe the actual Drive Max business Page to `messages`, complete the webhook
verification, and satisfy Meta's production access requirements. Personal
Marketplace Messenger conversations are outside this Page subscription.
Credentials are never returned by `/api/integrations` or exported to browsers.

Webhook POSTs verify HMAC-SHA256 over the original request bytes, filter Page
and recipient IDs, ignore message echoes/receipts, and acknowledge only after
all CRM writes commit. A transient database error returns non-2xx for Meta's
retry. The intake transaction creates the profile, opportunity, task, message
and alert jobs atomically. Preview/demo environments reject live intake.
`verify-facebook.mjs` runs production fixtures inside a rollback-only savepoint;
`tests/facebook.test.ts` exercises signatures, parsing, database writes,
permissions, deduplication, assignments and vehicle/deal preservation.

**Connection status at developer handoff:** the callback and CRM UI are
implemented; no Meta credentials were present in Vercel and the Meta browser
session was signed out. Do not describe the Page as connected until an actual
message arrives and appears in the CRM. Settings -> Lead sources & texting
shows whether configuration exists and the last received message time.

**Next communications priority:** Kyle confirmed **Telnyx** on October 27,
2026, and confirmed the Telnyx account has **not been set up yet**. Do not use
Twilio. Telnyx customer SMS and employee SMS alerts still need provider
account/number/campaign setup and transport implementation. Keep
customer consent and STOP handling separate from employee alert preferences.
Existing customer texts remain drafts. Do not change or port the public
252-541-0040 number without discussing the intended number arrangement first.

## Saved management reports and service (migration 029)

Owners/managers have **Management reports** and **Service** in the sidebar. Sales staff cannot read these tables through the workspace API or invoke their commands.

Management reports save dashboard cards, period/team/source filters, inventory age/no-appointment filters, overdue views, and unit/gross targets. Sales use preserved sold-deal snapshots and sold dates; leads use Eastern created dates. Incomplete deal costs are excluded and called out. Current balances, inventory, tasks and service are explicitly current; historical values are not invented. Results open the current customer, deal, vehicle or repair order, with CSV and print/PDF exports.

Daily/weekly/monthly schedules deliver immutable dated snapshots to the **Reports inbox**, using the existing five-minute authenticated production worker. This version does not send report emails. No schedule starts enabled. The manager who last saved the definition must remain active and authorized. Edits/archive cancel unfinished jobs; completed snapshots retain their original definition and figures. Jobs use leases, up to three attempts, revision checks and per-slot deduplication. Missed schedule intervals produce one current snapshot instead of misleading backfilled historical reports.

Service supports inventory recon, customer-pay repairs, warranty/goodwill, and We Owe promises, linked to a customer, opportunity and/or vehicle. It records assignments, shop/vendor, due dates, labor/parts/sublet items, estimates, actual costs, customer prices, reviewed tax, authorization, and work status. Scope/pricing changes invalidate authorization; actual-cost updates preserve it. Completion requires authorization and actual costs within the applicable approved amount. Completed/canceled work is frozen. New work or a correction to scope belongs on a new order; receipt reversals preserve payment history.

Customer-facing estimates, invoices and We Owe copies omit internal notes/costs. Recorded authorization documents an approval received outside the CRM, not an electronic signature. Customer-pay receipts record money already received; they do not charge a card or move funds. Inventory recon updates require explicit review of completed order costs plus other costs, replace the reviewed total, and reject sold inventory. Service receipts are a separate ledger and do not post to sales-deal accounting. A customer Service tab keeps repair history, inventory preparation can create a recon order, and Work Today highlights due repairs/promises.

`tests/management-service.test.ts` checks report periods/DST, calculations, demo command parity and historical snapshots. `verify-management-service.mjs` exercises real PostgreSQL commands, manager boundaries, approvals, reversals, recon, jobs, access removal and snapshot preservation. The release verification runs within a savepoint and rolls back all fixtures before migrations commit.

### Drive Max Protection product packets

In Desking, choose a Drive Max Protection product in Menu products, set price and coverage, select an option, and apply it. Only Drive Max's seven plans are offered; GAP, outside providers and generic protection products are unavailable. Previously saved non-Drive-Max products must be replaced or removed before applying an updated product list or menu; historical records remain readable. Contract selected products reviews the customer, VIN, issue date and starting mileage once and atomically issues every remaining selected Drive Max product. Reprints combine the selected issued agreements in menu order with a packet index. Issued prices and benefits are immutable; changing a menu does not rewrite an issued agreement.

Available programs: Deluxe and Platinum; prepaid maintenance (choose the included visit count, up to $125 per combined oil/filter change and rotation visit); tire and wheel; credit-card-size paintless dent repair; appearance (96 months, unlimited mileage); key replacement (three keys total, at most two in any rolling 12-month period). The five ancillary programs have a $0 deductible. Other than appearance, their month and mileage terms are configured in the menu. Record service date, mileage and key quantity when recording paid claims. Each contract keeps its own cancellation and refund record; unlimited-mileage contracts prorate by time only. The F&I Products register supports standalone issuance, lookup, claims, cancellation and packet reprinting.

Migration 031 retains the original five-page VSC edition and adds three-page ancillary agreements. The packet endpoint requires manager access and limits records to the caller's organization and the same customer/VIN. Production releases run rollback-only packet, benefit-limit and cancellation fixtures. Contract terms are dealership program drafts requiring review of the applicable terms and funding arrangements before real sales.
