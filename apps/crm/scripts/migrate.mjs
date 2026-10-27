import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";
import { verifyWebsiteIntake } from "./verify-website-intake.mjs";
import { verifyInventoryWebsite } from "./verify-inventory-website.mjs";
import { verifyEmail } from "./verify-email.mjs";
import { verifyWorkflows } from "./verify-workflows.mjs";
import { verifyAppraisals } from "./verify-appraisals.mjs";
import { verifyDocumentVault } from "./verify-document-vault.mjs";
import { setupWorkflowScheduler } from "./setup-workflow-scheduler.mjs";
if (process.env.VERCEL_ENV === "production") {
  if (!process.env.POSTGRES_URL)
    throw new Error("CRM database configuration is required.");
  const url = new URL(process.env.POSTGRES_URL);
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set(
      "sslrootcert",
      fileURLToPath(
        new URL("../certs/supabase-root-2021.crt", import.meta.url),
      ),
    );
  }
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 15000,
    query_timeout: 20000,
  });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("set local statement_timeout='15s'");
    await client.query("select pg_advisory_xact_lock(76102601)");
    await client.query(
      "create table if not exists public.dmcrm_schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now()); alter table public.dmcrm_schema_migrations enable row level security; revoke all on public.dmcrm_schema_migrations from public,anon,authenticated;",
    );
    const files = (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((n) => /^\d{3}_.*\.sql$/.test(n))
      .sort();
    for (const name of files) {
      const sql = await fs.readFile(
          new URL("../db/" + name, import.meta.url),
          "utf8",
        ),
        hash = createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query(
        "select checksum from public.dmcrm_schema_migrations where version=$1",
        [name],
      );
      if (rows.length) {
        if (rows[0].checksum !== hash)
          throw new Error("Applied migration changed");
        continue;
      }
      const baseline =
        name === "001_crm.sql" &&
        (
          await client.query(
            "select to_regclass('public.dmcrm_orgs') as existing",
          )
        ).rows[0].existing;
      if (!baseline) await client.query(sql);
      await client.query(
        "insert into public.dmcrm_schema_migrations(version,checksum) values($1,$2)",
        [name, hash],
      );
      console.log(
        baseline
          ? "Existing CRM foundation recorded."
          : "Applied CRM migration: " + name,
      );
    }
    await verifyWebsiteIntake(client);
    console.log(
      "Verified website-to-CRM intake with rolled-back fixtures: contact, test drive, sell-your-car, retry deduplication.",
    );
    await verifyInventoryWebsite(client);
    console.log(
      "Verified CRM-to-website inventory with rolled-back fixtures: drafts, preserved merchandising, sold visibility, unwind, no duplicates.",
    );
    await verifyEmail(client);
    console.log(
      "Verified CRM email with rolled-back fixtures: drafts, idempotent sends, delivery events, replies, automatic acknowledgments.",
    );
    await verifyWorkflows(client);
    await verifyAppraisals(client);
    await verifyDocumentVault(client);
    console.log(
      "Verified document vault with rolled-back fixtures: private storage, historical stock/VIN, idempotent filing and retention protection.",
    );
    console.log(
      "Verified appraisals with rolled-back fixtures: approval, ACV isolation, audit revisions and immutable saved quotes.",
    );
    console.log(
      "Verified workflows with rolled-back fixtures: appointment changes, reminder cancellation, customer responses and no persistent test emails.",
    );
    await setupWorkflowScheduler(client);
    console.log(
      "Configured existing database scheduler: five-minute CRM email and device-notification checks.",
    );
    // PostgREST refreshes its table/function cache asynchronously after DDL.
    // Deliver the notification at commit; the REST release check waits for it.
    await client.query("notify pgrst, 'reload schema'");
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error(
      "CRM migration failed. Code:",
      /^[A-Z0-9_]+$/.test(e?.code || "") ? e.code : "UNKNOWN",
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
