// Read-only diagnostic: prints only title-case IDs and selected financial fields.
// Run explicitly with the existing CRM runtime's database connection; never exports credentials.
import { fileURLToPath } from "node:url";
import pg from "pg";
const org = "d5a1c100-0000-4000-8000-000000000001";
if (!process.env.POSTGRES_URL) throw new Error("Database configuration required");
const url = new URL(process.env.POSTGRES_URL);
if (url.hostname.endsWith(".pooler.supabase.com")) {
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("sslrootcert", fileURLToPath(new URL("../certs/supabase-root-2021.crt", import.meta.url)));
}
const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, query_timeout: 15000 });
const keys = ["price", "docFee", "tax", "taxMode", "taxReason", "titleFee", "tradeAllowance", "addOns", "otherTaxes"];
const pick = value => value == null ? null : Object.fromEntries(keys.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
try {
  await client.connect();
  await client.query("begin read only");
  await client.query("set local statement_timeout='15s'");
  const {rows} = await client.query(`
    select c.id as case_id, c.sale_id, c.opportunity_id, c.status, c.sold_on,
      s.created_at as sale_created_at, s.snapshot->'quote'->'values' as sale_values,
      s.snapshot->'quote'->>'id' as sale_quote_id,
      o.sale_snapshot->'quote'->'values' as opportunity_values,
      o.sale_snapshot->'quote'->>'id' as opportunity_quote_id,
      q.values as latest_matching_values, q.id as latest_matching_quote_id, q.created_at as quote_created_at,
      o.paperwork#>>'{bill-of-sale,title_fee}' as printed_title_fee,
      o.paperwork#>>'{bill-of-sale,highway_use_tax}' as printed_tax,
      o.paperwork#>>'{$common,deal.title_fee}' as shared_print_fee,
      o.paperwork#>>'{$common,deal.tax}' as shared_print_tax,
      s.snapshot->'quote'->'vehicle_details'->>'price' as vehicle_price
    from public.dmcrm_title_cases c
    join public.dmcrm_sales s on s.id=c.sale_id and s.org_id=c.org_id
    join public.dmcrm_opportunities o on o.id=c.opportunity_id and o.org_id=c.org_id
    left join lateral (
      select q.id,q.values,q.created_at from public.dmcrm_quotes q
      where q.org_id=c.org_id and q.opportunity_id=c.opportunity_id
        and q.inventory_id is not distinct from o.inventory_id
        and (o.inventory_id is not null or q.vehicle=o.vehicle_interest)
      order by q.created_at desc limit 1
    ) q on true
    where c.org_id=$1 and c.status<>'complete' and s.status='sold'
    order by c.sold_on,c.created_at,c.id limit 50`, [org]);
  for (const row of rows) console.log("TITLE_AMOUNT_DIAGNOSTIC " + JSON.stringify({...row, sale_values:pick(row.sale_values), opportunity_values:pick(row.opportunity_values), latest_matching_values:pick(row.latest_matching_values)}));
  console.log("TITLE_AMOUNT_DIAGNOSTIC_COUNT " + rows.length);
} catch(e) {
  console.error("Title amount inspection failed", /^[A-Z0-9_]+$/.test(e?.code || "") ? e.code : "UNKNOWN");
  process.exitCode=1;
} finally {
  await client.query("rollback").catch(()=>{});
  await client.end().catch(()=>{});
}
