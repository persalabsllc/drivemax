# Drive Max CRM — foundation release

A standalone Next.js application for Drive Max customer management, showroom visits, follow-up planning, preliminary quotes, and manual trade worksheets. It uses the existing Vercel team and Supabase authentication service, with exclusively `dmcrm_*` business tables. The public website and Control Room application are not changed.

## Deployment boundaries

- Vercel project: `drive-max-crm` (`prj_mMh5v8DCSJBufyLSALIeHzfGAjE9`) in the existing Persa Labs team.
- Standalone source: this folder. It can move unchanged into its own repository root; then set Vercel Root Directory accordingly.
- Never merge this work into the website's `main` branch without review. No domain or website routing changes are required for the separate project.
- `/` requires a verified existing account and active CRM dealership membership.
- `/demo` uses fictional, in-memory sample data. Demo mutations never reach the live API or persist in local storage.
- `/login` uses the existing Supabase identity provider, a separate cookie name, and local-scope sign-out.
- The new project has its own deployment settings and environment variables. Do not copy website email/cron settings.

## Setup

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
- Mark sold updates the linked CRM inventory vehicle to sold and the latest same-day visit to sold without changing its departure timestamp.
- Customer-facing quote printing and preliminary deal-summary checklist printing; browser Save as PDF supported.
- Workspace JSON export and server-side mutation audit log.

## Access and tenant boundaries

Every read independently verifies the authenticated user and active CRM membership, then scopes all queries by the server-resolved dealership. Every mutation is schema-validated and passed to an atomic RPC that re-checks membership and validates cross-record tenant references. Anonymous/authenticated browser roles cannot access business tables or invoke the command RPC. Composite foreign keys reject cross-dealership references. POST requires a matching Origin. Only trusted server code has the service role key.

The foundation uses one active dealership per user in the UI. The database supports multiple dealerships, but self-service onboarding, organization switching, invitations, granular role enforcement, MFA enrollment UX, billing, backup/restore drills, large-book pagination, and production observability remain pre-commercial-launch work. Shared Supabase infrastructure and owner identities are still dependencies to separate when migrating to an independent hosting account.

## Explicitly not connected yet

Two-way email/SMS, automated outbound messages, telephony, website lead import, website inventory synchronization, live book values, e-signatures, lender submissions, and regulated final contracts. Nothing is sent when a sample interaction is logged. Deal summary is not a completed legal sold pack. Current sale status represents one active opportunity per customer; a full repeat-purchase/deal ledger is a later stage.

## Checks

- `npm run typecheck`
- `npm test` — quote calculations; Eastern dates; validation; demo transitions; actual PostgreSQL-compatible migration/RPC integration with PGlite, including cross-tenant and browser-role denials, visit deduplication, sale follow-up and anniversary behavior.
- `npm run build`

Manual acceptance: create customer → add note/call → check in → create quote → mark sold → confirm visit remains open → check out → confirm follow-up → reload and verify persistence. For inventory: add/decode VIN → select inventory in a customer → enter required trade values → verify desking price/cost/days/trade → save → end an unsold visit → confirm Left and retained visit → reload. Test the demo separately; a demo pass alone is not evidence of live backend integration.
