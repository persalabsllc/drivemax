# Drive Max appraisals and inventory pricing

Staff enter through **Control Room → Appraisals & pricing**. Inventory rows and the vehicle editor have an **Appraise / price** link.

1. Enter VIN and actual odometer, or choose an existing inventory vehicle. Decode the VIN and confirm year, make, model, trim, drivetrain, title, and condition.
2. New Bern ZIP 28562, 100-mile radius, exact model year, and ±30,000-mile comp window are defaults. Broaden filters deliberately if the sample is thin. Missing trim requires manual review of comparable equipment.
3. Start with the free, no-account workflow: use the Cars.com, Autotrader, and CarGurus search shortcuts, review 3–10 suitable listings, and enter their asking prices, odometers, sources, and links with **Add comparable**. Retail quartiles, the target asking price, and the buy cap calculate automatically. Alternatively, connect the optional MarketCheck listings API. Enter sourced book references or documented transaction prices when available. Exclude unsuitable comps. Asking prices are never labeled as completed transactions.
4. Choose a pricing strategy and enter recon, costs, transport, negotiation allowance, and target front-end profit. Condition/equipment dollar adjustments and retail overrides are explicit operator decisions.
5. Save the appraisal. For a linked current inventory vehicle, select **Use target for inventory**, review the amount, then **Update website price**. The public site adds its existing $399 dealer administration fee. The worksheet uses the vehicle price and excludes dealer-fee income, tax, tags, finance income, and ongoing overhead.

## Free workflow and optional data connection

No valuation subscription was purchased or activated with this release. VIN decoding uses the existing free NHTSA integration. NHTSA does not provide prices.

Manual comparisons, recorded Drive Max sale prices, valuation calculations, and saved appraisals require no valuation API account. External search shortcuts open Google searches restricted to the selected listing site; staff enter the relevant details after reviewing the listing. No automated website scraping is performed.

An owner can expand **Market data connection** and save a MarketCheck API key directly in the authenticated form. As checked October 7, 2026, MarketCheck advertises a $0 plan with 500 API calls per month and a 100-mile search radius; Basic is $299/month plus data fees and Standard is $749/month plus data fees. Confirm the actual free-plan Inventory Search permissions and per-call fees in the account dashboard before connecting; the app does not purchase, switch, or cancel provider plans. Only `GET /v2/search/car/active` is requested. Proprietary prediction, book, history, and transaction endpoints are not requested.

The connection check and each lookup use one inventory request. A database counter atomically caps Drive Max at 450 attempts per UTC calendar month across all staff, leaving some headroom within the advertised free allowance. Failed attempts count conservatively. Other uses of the same provider account consume its allowance too. The cap cannot prevent charges from an already-paid subscription or billable account configuration. Searches above 100 miles are rejected before calling the provider; wider manual comparisons remain available.

Market searches request up to 50 nearest results; provider plan restrictions may return fewer, and the UI displays the usable count. Recommendations use included asking-price percentiles. The middle 50% of included prices supplies the displayed retail range. Review trim, equipment, history, mileage, and differing dealer fees before using those figures.

MarketCheck's published developer terms restrict persistent caching and response archives. API responses are transient and are never reused through a persistent cache. Saving discards provider listings and retains the operator's reviewed retail price as an explicit value, alongside private costs, manual evidence, and recorded sales. Automatic preservation of the reviewed price requires a current snapshot no more than 24 hours old and a clean-title appraisal. Unverified or branded titles still require a deliberate operator override. A fresh lookup clears an automatically saved reviewed price so new comparisons can determine the next target; a manually entered override remains in effect.

Book references are manual, dated inputs in this release. A licensed J.D. Power/Black Book/KBB/MMR account or future contracted API connection is needed for automatic proprietary book values. Market-wide verified closed-sale or auction transaction prices require their own licensed feed. Manual confirmed sales require evidence/source and a date. Actual Drive Max vehicle sales can be recorded after closing and become a 90-day reference for matching year/make/model/ZIP/mileage/trim. Historical advertised inventory prices are never substituted for actual sale prices.

## Persistence and access

The authenticated appraisal endpoint initializes only the private appraisal tables in `supabase/migrations/202610060001_appraisals.sql`, with a transaction lock and idempotent DDL. It uses the existing Drive Max `POSTGRES_URL` (preferred pooler for Vercel) or `POSTGRES_URL_NON_POOLING`. No new database or subscription is provisioned. Every route requires an active staff session. Only owners can change the provider connection. Cross-origin writes are denied, and market lookup and connection requests have durable per-staff limits.

API keys are encrypted with AES-256-GCM using a domain-separated key derived from the existing `LEAD_RATE_LIMIT_SECRET`; rotating that secret requires reconnecting MarketCheck. Provider keys are never returned to browsers. An optional server-only `MARKETCHECK_API_KEY` environment variable takes precedence over the saved connection.

Appraisal data, private costs, recorded sales, and encrypted keys are kept in separate tables with no anonymous/authenticated database permissions. Public inventory never reads these tables. Inventory price updates use server-calculated saved figures, check VIN and inventory status, and reject concurrent edits. Appraisal saves also reject stale timestamps.

Saved appraisals retain the reviewed price and internal sale evidence, rather than a provider-data snapshot. Changing VIN resets prior vehicle-specific values; changing mileage or filters excludes old in-session market data. Refresh market data before purchase or repricing decisions. Print the worksheet from its action bar.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` cover valuation calculations, data attribution, absent data, mileage adjustment, stale snapshots, duplicate comps, input/URL validation, encryption authentication, database migration, private table permissions, save/reload, concurrent-update rejection, reviewed-price persistence without provider archives, and the shared monthly request cap. Live provider access requires an account API key; a staff sign-in is needed to verify the deployed authenticated workflow.

Primary references: [MarketCheck plans](https://www.marketcheck.com/apis/pricing/), [quota limits](https://docs.marketcheck.com/docs/get-started/api/quota-and-rate-limits), [developer terms](https://developers.marketcheck.com/terms), [Inventory Search](https://docs.marketcheck.com/docs/api/cars/inventory/inventory-search), [J.D. Power values](https://www.jdpowervalues.com/get-values/web-service-used-car-commercial-truck), [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
