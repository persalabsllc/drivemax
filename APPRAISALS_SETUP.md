# Drive Max appraisals and inventory pricing

Staff enter through **Control Room → Appraisals & pricing**. Inventory rows and the vehicle editor have an **Appraise / price** link.

1. Enter VIN and actual odometer, or choose an existing inventory vehicle. Decode the VIN and confirm year, make, model, trim, drivetrain, title, and condition.
2. New Bern ZIP 28562, 100-mile radius, exact model year, and ±30,000-mile comp window are defaults. Broaden filters deliberately if the sample is thin. Missing trim requires manual review of comparable equipment.
3. Run a market lookup, enter sourced book references, and/or add manual listings and documented transaction prices. Exclude unsuitable comps. Asking prices are never labeled as completed transactions.
4. Choose a pricing strategy and enter recon, costs, transport, negotiation allowance, and target front-end profit. Condition/equipment dollar adjustments and retail overrides are explicit operator decisions.
5. Save the appraisal. For a linked current inventory vehicle, select **Use target for inventory**, review the amount, then **Update website price**. The public site adds its existing $399 dealer administration fee. The worksheet uses the vehicle price and excludes dealer-fee income, tax, tags, finance income, and ongoing overhead.

## Data connections

No valuation subscription was purchased or activated with this release. VIN decoding uses the existing free NHTSA integration. NHTSA does not provide prices.

An owner can expand **Market data connection** and save a MarketCheck API key directly in the authenticated form. The account needs access to:

- `GET /v2/search/car/active` — active used-car dealer listings near the selected ZIP.
- `GET /v2/predict/car/us/marketcheck_price` — US Used Base prediction for VIN, miles, ZIP, independent dealer, non-CPO.

The connection check makes one inventory request. A fresh lookup makes one inventory search and one price prediction; account billing is controlled by MarketCheck. Successful identical queries are cached privately for six hours. Partial responses remain retryable. Market searches return up to 50 nearest results, not every vehicle in the market. Listing prices, sample quartiles, and price rank need review for trim, equipment, history, and differing dealer fees. The provider estimate is a model estimate, not a guaranteed transaction or book value.

Book references are manual, dated inputs in this release. A licensed J.D. Power/Black Book/KBB/MMR account or future contracted API connection is needed for automatic proprietary book values. Market-wide verified closed-sale or auction transaction prices require their own licensed feed. Manual confirmed sales require evidence/source and a date. Actual Drive Max vehicle sales can be recorded after closing and become a 90-day reference for matching year/make/model/ZIP/mileage/trim. Historical advertised inventory prices are never substituted for actual sale prices.

## Persistence and access

The authenticated appraisal endpoint initializes only the private appraisal tables in `supabase/migrations/202610060001_appraisals.sql`, with a transaction lock and idempotent DDL. It uses the existing Drive Max `POSTGRES_URL` (preferred pooler for Vercel) or `POSTGRES_URL_NON_POOLING`. No new database or subscription is provisioned. Every route requires an active staff session. Only owners can change the provider connection. Cross-origin writes are denied, and market lookup and connection requests have durable per-staff limits.

API keys are encrypted with AES-256-GCM using a domain-separated key derived from the existing `LEAD_RATE_LIMIT_SECRET`; rotating that secret requires reconnecting MarketCheck. Provider keys are never returned to browsers. An optional server-only `MARKETCHECK_API_KEY` environment variable takes precedence over the saved connection.

Appraisal data, private costs, snapshots, and encrypted keys are kept in separate tables with no anonymous/authenticated database permissions. Public inventory never reads these tables. Inventory price updates use server-calculated saved figures, check VIN and inventory status, and reject concurrent edits. Appraisal saves also reject stale timestamps.

Saved appraisals retain their market snapshot and internal sale evidence. Changing VIN resets prior vehicle-specific values; changing mileage or filters excludes old market data. Refresh older snapshots before purchase or repricing decisions. Print the worksheet from its action bar.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` cover valuation calculations, data attribution, absent data, mileage adjustment, stale snapshots, duplicate comps, input/URL validation, encryption authentication, database migration, private table permissions, save/reload, and concurrent-update rejection. Live paid provider access requires an account API key; a staff sign-in is needed to verify the deployed authenticated workflow.

Primary provider references: [MarketCheck Price](https://docs.marketcheck.com/docs/api/cars/market-insights/marketcheck-price), [Inventory Search](https://docs.marketcheck.com/docs/api/cars/inventory/inventory-search), [J.D. Power values](https://www.jdpowervalues.com/get-values/web-service-used-car-commercial-truck), [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
