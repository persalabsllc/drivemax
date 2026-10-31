# Website activity

The manager-only Website activity view reports consenting website visits, vehicle attention, sources, and later CRM outcomes. A Website tab on customer profiles exposes only visits explicitly linked to that customer; the API and SQL both enforce active membership and customer assignment for nonmanagers. Finance Managers do not receive global reports.

## Definitions

- A unique browser is a random, opaque first-party identifier, not a verified person. No fingerprint or IP is stored in the activity tables. The credential is HTTP-only, Secure in production, and hashed in the database.
- A visit expires after 30 minutes without recorded activity. Return visits indicate a previously recorded browser, not necessarily a repeat view of the same vehicle.
- Active time is approximate foreground time while interacting or within a minute of the last interaction. Background tabs stop the timer. It is not total wall-clock dwell time.
- Vehicle lead visits count visits that both viewed a vehicle and produced a saved CRM lead. They do not assert the inquiry was about that exact vehicle.
- Form and chat links are written by validated server handlers. Browser events cannot claim leads, appointments, or sales. Links survive delayed CRM intake. Lead totals deduplicate customer IDs; conversion rate uses visits with a lead divided by tracked visits.
- Appointments and sales are current outcomes of opportunities linked to visits that began within the selected Eastern-date cohort. They may occur after the date range. Canceled appointments and unwound sales are excluded.
- The page shows 50 visits at a time, up to 100 vehicle rows and the first 500 non-heartbeat events in a visit. Source and vehicle filters apply to the whole visit cohort.

## Privacy and operation

Collection starts only after Allow analytics. No thanks and browser GPC/DNT signals disable analytics. Privacy choices remains in the public website footer. No form values, full referrers, query strings, keystrokes, or session replay are collected. Attribution uses the current visit's opaque browser credential; it does not identify anonymous browsers by email or IP. No cross-device matching is attempted.

Preview deployments, recognized bots, and signed-in website staff are excluded. Other staff browsing while signed out may appear as ordinary visitors. Analytics is best effort and never prevents a customer inquiry, chat, or booking if recording fails.

Migration 037 is additive. Deploy CRM first to install the schema and run the rollback verifier, then deploy the website collector. The existing database scheduler runs `dmcrm_web_prune` daily, removing visits older than 180 days and their events/links. Source customer and sales records are unaffected. Browser identifiers expire 90 days after the last tracked request.

Verification: `node --import tsx --test tests/website-activity.test.ts` exercises the actual website/CRM migrations plus the same rollback verifier used at production deployment. It covers private data access, token mismatch, safe route validation, retry deduplication, session expiry, real conversion deduplication, canceled/unwound outcomes, and retention.
