// Explicit, guarded administration command. Deal identifiers/figures are supplied
// privately at execution, never committed. Only title tracking is changed.
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { pendingTitleTotals } from "../lib/title-clerk-money.ts";
const amount = z.number().min(0).max(1000000).multipleOf(0.01);
const fields = [
  "price",
  "docFee",
  "tax",
  "taxMode",
  "taxReason",
  "titleFee",
  "tradeAllowance",
  "addOns",
  "otherTaxes",
];
const manifestSchema = z
  .array(
    z
      .object({
        org_id: z.uuid(),
        case_id: z.uuid(),
        sale_id: z.uuid(),
        quote_id: z.uuid(),
        expected_values: z.record(
          z.enum(fields),
          z.union([z.number(), z.string(), z.null()]),
        ),
        values: z
          .object({
            fees: amount,
            taxes: amount,
            note: z.string().trim().min(3).max(1000),
          })
          .strict(),
      })
      .strict(),
  )
  .min(1)
  .max(50);

export async function repairTitleAmounts(client, input) {
  const manifest = manifestSchema.parse(input);
  const result = { corrected: 0, alreadyCorrect: 0 };
  await client.query("begin");
  try {
    await client.query("set local statement_timeout='15s'");
    await client.query("select pg_advisory_xact_lock(76102823)");
    for (const item of manifest) {
      const { rows } = await client.query(
        `select c.id,c.revision,c.amounts,s.snapshot,s.accounting,o.sale_snapshot,q.values as original_quote
        from public.dmcrm_title_cases c
        join public.dmcrm_sales s on s.id=c.sale_id and s.org_id=c.org_id
        join public.dmcrm_opportunities o on o.id=c.opportunity_id and o.org_id=c.org_id
        join public.dmcrm_quotes q on q.id=$4 and q.org_id=c.org_id and q.opportunity_id=c.opportunity_id
        where c.org_id=$1 and c.id=$2 and c.sale_id=$3 and c.status<>'complete' and s.status='sold'
          and s.snapshot#>>'{quote,id}'=$4::text`,
        [item.org_id, item.case_id, item.sale_id, item.quote_id],
      );
      const row = rows[0];
      if (!row) throw new Error("Repair target changed or unavailable");
      const saved = row.snapshot?.quote?.values;
      if (
        !saved ||
        Object.entries(item.expected_values).some(
          ([key, value]) => (saved[key] ?? null) !== value,
        )
      )
        throw new Error("Saved figures changed; inspect again before repair");
      if (row.amounts) {
        if (
          row.amounts.fees === item.values.fees &&
          row.amounts.taxes === item.values.taxes
        ) {
          result.alreadyCorrect++;
          continue;
        }
        throw new Error(
          "Title amounts already reviewed; preserve the intervening correction",
        );
      }
      const owner = (
        await client.query(
          `select s.user_id from public.dmcrm_staff s
        join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
        where s.org_id=$1 and s.active and m.active and s.role='owner' and m.role='owner'
        order by s.user_id limit 1`,
          [item.org_id],
        )
      ).rows[0];
      if (!owner) throw new Error("Active owner required for requested repair");
      await client.query("select public.dmcrm_command($1,$2,$3::jsonb)", [
        item.org_id,
        owner.user_id,
        JSON.stringify({
          type: "save_title_amounts",
          id: item.case_id,
          revision: row.revision,
          values: item.values,
        }),
      ]);
      const after = (
        await client.query(
          `select s.snapshot,s.accounting,o.sale_snapshot,q.values as original_quote
        from public.dmcrm_sales s join public.dmcrm_opportunities o on o.id=s.opportunity_id and o.org_id=s.org_id
        join public.dmcrm_quotes q on q.id=$3 and q.org_id=s.org_id where s.org_id=$1 and s.id=$2`,
          [item.org_id, item.sale_id, item.quote_id],
        )
      ).rows[0];
      for (const key of [
        "snapshot",
        "accounting",
        "sale_snapshot",
        "original_quote",
      ])
        if (JSON.stringify(row[key]) !== JSON.stringify(after[key]))
          throw new Error("Repair must preserve sold figures");
      result.corrected++;
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

// Uses the same resolver as the UI; prints aggregate amounts only, no customer data.
export async function readPendingTitleTotals(client, org) {
  const { rows } = await client.query(
    `select to_jsonb(c) as title_case,to_jsonb(s) as sale
    from public.dmcrm_title_cases c join public.dmcrm_sales s on s.org_id=c.org_id and s.id=c.sale_id
    where c.org_id=$1 and c.status<>'complete' and s.status='sold'`,
    [org],
  );
  return pendingTitleTotals({
    member: { role: "owner" },
    opportunities: [],
    sales: rows.map((r) => r.sale),
    title_cases: rows.map((r) => r.title_case),
  });
}

async function main() {
  let client;
  try {
    const input = JSON.parse(
      Buffer.from(process.argv[2] || "", "base64").toString("utf8"),
    );
    manifestSchema.parse(input);
    const url = new URL(process.env.POSTGRES_URL || "");
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      url.searchParams.set("sslmode", "verify-full");
      url.searchParams.set(
        "sslrootcert",
        fileURLToPath(
          new URL("../certs/supabase-root-2021.crt", import.meta.url),
        ),
      );
    }
    client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 15000,
      query_timeout: 20000,
    });
    await client.connect();
    console.log(
      "TITLE_AMOUNT_REPAIR " +
        JSON.stringify(await repairTitleAmounts(client, input)),
    );
    for (const org of new Set(input.map((item) => item.org_id)))
      console.log(
        "TITLE_AMOUNT_TOTALS " +
          JSON.stringify(await readPendingTitleTotals(client, org)),
      );
  } catch (error) {
    console.error(
      "Title amount repair failed",
      error instanceof z.ZodError
        ? "Invalid repair manifest"
        : String(error.message).replace(
            /postgres(?:ql)?:\/\/\S+/g,
            "[redacted connection]",
          ),
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
