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

`npm run build` applies the additive migration only when `VERCEL_ENV=production`, under a transaction and advisory lock. Preview/local builds never migrate shared storage. It creates only CRM tables/functions and reads active owner identities from `public.staff` to seed CRM memberships. It does not change those identities or existing tables. Subsequent upgrades require explicitly versioned migrations; do not edit an already-applied migration.

The initial workspace contains no real customer data. Existing website leads and inventory are not automatically imported.

## Working features

- Customer creation/editing/search, vehicle of interest and trade description.
- Per-customer notes and manual inbound/outbound call outcome history.
- Showroom check-in/check-out with independent sale outcome; dates use America/New_York.
- Daily, weekly and monthly planner; task completion; birthday and purchase-anniversary renewal on completion.
- Atomic sold transition cancels unsold follow-up and schedules 2/7/30-day follow-up plus annual reminder. Duplicate requests do not duplicate visits or sale tasks.
- Versioned quotes with manually verified tax/title figures, trade allowance/payoff, illustrative payments, and private ACV/reconditioning fields.
- Customer-facing quote printing and preliminary deal-summary checklist printing; browser Save as PDF supported.
- Workspace JSON export and server-side mutation audit log.

## Access and tenant boundaries

Every read independently verifies the authenticated user and active CRM membership, then scopes all queries by the server-resolved dealership. Every mutation is schema-validated and passed to an atomic RPC that re-checks membership and validates cross-record tenant references. Anonymous/authenticated browser roles cannot access business tables or invoke the command RPC. Composite foreign keys reject cross-dealership references. POST requires a matching Origin. Only trusted server code has the service role key.

The foundation uses one active dealership per user in the UI. The database supports multiple dealerships, but self-service onboarding, organization switching, invitations, granular role enforcement, MFA enrollment UX, billing, backup/restore drills, large-book pagination, and production observability remain pre-commercial-launch work. Shared Supabase infrastructure and owner identities are still dependencies to separate when migrating to an independent hosting account.

## Explicitly not connected yet

Two-way email/SMS, automated outbound messages, telephony, website lead import, inventory synchronization, live book values, VIN data, e-signatures, lender submissions, and regulated final contracts. Nothing is sent when a sample interaction is logged. Deal summary is not a completed legal sold pack. Current sale status represents one active opportunity per customer; a full repeat-purchase/deal ledger is a later stage.

## Checks

- `npm run typecheck`
- `npm test` — quote calculations; Eastern dates; validation; demo transitions; actual PostgreSQL-compatible migration/RPC integration with PGlite, including cross-tenant and browser-role denials, visit deduplication, sale follow-up and anniversary behavior.
- `npm run build`

Manual acceptance: create customer → add note/call → check in → create quote → mark sold → confirm visit remains open → check out → confirm follow-up → reload and verify persistence. Test the demo separately; a demo pass alone is not evidence of live backend integration.
