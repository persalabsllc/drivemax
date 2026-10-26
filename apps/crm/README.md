# Drive Max CRM

A standalone Next.js application for Drive Max customer management, showroom visits, follow-up planning, preliminary quotes, and manual trade worksheets. It uses the existing Vercel team and Supabase authentication service, with exclusively `dmcrm_*` business tables. The public website and Control Room application are not changed.

## Deployment boundaries

- Vercel project: `drive-max-crm` (`prj_mMh5v8DCSJBufyLSALIeHzfGAjE9`) in the existing Persa Labs team.
- Standalone source: this folder. It can move unchanged into its own repository root; then set Vercel Root Directory accordingly.
- Never merge this work into the website's `main` branch without review. No domain or website routing changes are required for the separate project.
- `/` requires a verified account, active CRM dealership membership, and an active linked CRM team record.
- `/demo` uses fictional, in-memory sample data. Demo mutations never reach the live API or persist in local storage.
- `/login` uses the existing Supabase identity provider, a separate cookie name, and local-scope sign-out. `/team-setup` accepts a one-use, 72-hour setup link issued by an authorized manager. Tokens are hashed in storage and carried in the URL fragment; no invitation email is sent automatically.
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
- Salespeople receive only their assigned tasks from the server; owners/managers receive the full team queue with filters. Customer profiles remain shared within the dealership. This is the routing foundation for future messaging, not an inbound-message integration.
- Workspace JSON export (with the same task visibility as the signed-in user) and server-side mutation audit log.

## Customer appointments

- Schedule a timed appointment while creating a customer or from any existing profile, Overview, or Planner. New-customer creation and its optional appointment save in one database transaction.
- Types: test drive, return visit, vehicle viewing, sold delivery, service, trade appraisal, financing/paperwork, and other. Each appointment has an assigned active salesperson, date/time, 15–240 minute duration, and a brief description. Times are entered and displayed in Eastern Time regardless of the browser's timezone; skipped or ambiguous daylight-saving times are rejected.
- Overview shows upcoming appointments with customer, salesperson, time, type and description, with Today / Next 7 days / past unresolved and salesperson filters. Today includes recorded outcomes. Appointments also appear in the daily/weekly/monthly Planner and at the top of customer profiles, including closed appointment history.
- Appointments can be confirmed, rescheduled, marked arrived/completed/no-show, or canceled. Arrived also checks the customer into the showroom; completing an appointment does not end their showroom visit. Rescheduling clears a prior confirmation. Closed records remain read-only; schedule another appointment for another visit.
- Scheduling and every change write a readable customer activity and an immutable before/after audit entry. Revision checks prevent overwriting another session's edits. Overlapping bookings for the same salesperson show a warning and can still be saved intentionally.
- The team schedule is shared within the dealership. Salespeople can schedule and manage their own appointments; owners/managers can assign and manage anyone's. Appointments have independent assignments; deactivating a salesperson hands their open appointments to the selected replacement and retains completed attribution. Planner follows the existing owner filter and shows a salesperson's own appointments to that salesperson.
- Delivery/service appointments can reference sold opportunities. Appointment changes never silently change deal status, cancel other bookings, or send messages. Existing date-only appointment tasks remain intact without invented times. No email/SMS reminders or external calendar sync are enabled.

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

### Messaging activation boundary

No outbound messages or automated receipts are enabled. `dmcrm_messages` holds chronological inbound/outbound records and drafts; `lib/messaging.ts` defines the provider contract; the send route returns a clear disconnected response without mutating the draft. A saved quote reference supports producing the customer PDF later. Provider setup must implement an atomic outbox claim with the message UUID as idempotency key, verified inbound/delivery webhooks, provider-ID deduplication, sender setup, opt-out/consent enforcement and failure handling before enabling Send. Connecting credentials must never auto-send existing drafts. User-supplied inbound content must be treated as untrusted data.

## Access and tenant boundaries

Every read independently verifies the authenticated user and active CRM membership, then scopes all queries by the server-resolved dealership. Every mutation is schema-validated and passed to an atomic RPC that re-checks membership and validates cross-record tenant references. Anonymous/authenticated browser roles cannot access business tables or invoke the command RPC. Composite foreign keys reject cross-dealership references. POST requires a matching Origin. Only trusted server code has the service role key.

The foundation uses one active dealership per user in the UI. The database supports multiple dealerships, but self-service onboarding, organization switching, customer-level permissions, MFA enrollment UX, billing, backup/restore drills, large-book pagination, and production observability remain pre-commercial-launch work. Shared Supabase infrastructure and owner identities are still dependencies to separate when migrating to an independent hosting account.

## Explicitly not connected yet

Two-way email/SMS, automated outbound messages, telephony, website inventory synchronization, live book values, e-signatures, lender submissions, and regulated final contracts. Nothing is sent when a sample interaction is logged. Printed forms require review and signatures; condition attestations, signatures, and notarization are not filled automatically.

## Checks

- `npm run typecheck`
- `npm test` — quote calculations; Eastern dates; validation; demo transitions; actual PostgreSQL-compatible migration/RPC integration with PGlite, including cross-tenant and browser-role denials, visit deduplication, sale follow-up and anniversary behavior; team ownership/permissions, secure invitation claims and handoffs, and real 12/16-page sold packs with independent trade fields.
- `npm run build`

Manual acceptance: create customer → add note/call → check in → create quote → mark sold → confirm visit remains open → check out → confirm follow-up → reload and verify persistence. For inventory: add/decode VIN → select inventory in a customer → enter required trade values → verify desking price/cost/days/trade → save → end an unsold visit → confirm Left and retained visit → reload. Test the demo separately; a demo pass alone is not evidence of live backend integration.

## Staff accounts and contact details

Settings → Your team → Add user requires first name, last name, email, phone, street address, city, state, and ZIP (address line 2 is optional). Phone numbers are normalized with a country code for future notifications. Phone/address fields are excluded from salesperson workspace payloads and exports; they are visible to managers. Existing staff names are migrated without inventing missing contact information; complete those fields when editing a record.

Owners can add salespeople and managers; managers can add salespeople. Set an initial password of at least 12 characters to create a login immediately, or use the existing private setup-link flow. No email or SMS is sent. Dedicated CRM accounts expose Set password / Reset password to authorized managers, with an audit entry and no stored or retrievable plaintext password. Existing logins linked from another application retain their original password recovery; owners, self-management, cross-dealership identities, and Control Room accounts are protected. Newly created identities are linked atomically to CRM membership, and failed links clean up only identities confirmed unlinked. No existing user credentials are changed by deployment.


## Website lead intake

Migration `012_website_intake.sql` connects the public site's existing `submit_lead` transaction to the CRM in the shared Supabase database. Test-drive, sell-your-car, general contact, financing, and other vehicle inquiries create a Website opportunity, the original inquiry in Activity, and a due-today follow-up task. Employment applications stay in the website inbox. No website form change, second endpoint, new secret, or outbound message is required.

Each website request ID is imported once. A normalized email/phone match reuses a customer only when exactly one profile matches and the full name agrees. Conflicting/shared contact details create a separate profile with an explicit review note. Existing profile details and sold deals are preserved. An active existing salesperson is retained; otherwise a linked website staff identity is used if available, with remaining inquiries unassigned in the owner/manager attention feed. Assign the opportunity through the normal salesperson selector.

The original server-captured vehicle snapshot is retained. Inventory is linked by VIN only when the CRM unit is available; website and CRM inventory IDs are independent. Requested test-drive times require staff confirmation. Seller vehicles remain appraisal inquiries, with condition, title, mileage, asking price and payoff information in Activity; they are not stock or trade inventory. Follow-up tasks use the preferred channel, with SMS selected only for explicit current customer-care consent. No automatic appointment or message is created.

The private intake table retains source payloads and mapping IDs independently of later website edits. Imports run atomically inside a failure-isolated trigger. Failures keep the original website inquiry and notification queue intact, leave no partial CRM deal, and retry with bounded backoff during the existing 30-second CRM attention refresh. That refresh also recovers unqueued open inquiries in batches of 20. Owners/managers see a pending-import warning; applicants and closed historical website deals are excluded from backfill. Website request alerts have per-user review receipts, including requests from returning customers. Existing open website inquiries are imported on rollout/refresh.

This is one-way form intake, not a synchronization of Control Room status changes, later email conversations, or inventory. CRM email/SMS provider activation remains separate. Tests exercise both applications' actual SQL migrations and the website's `submit_lead` procedure. Production migrations additionally run contact, test-drive, seller and duplicate-retry fixtures within a savepoint and roll them back before committing; no test leads or notifications survive.
