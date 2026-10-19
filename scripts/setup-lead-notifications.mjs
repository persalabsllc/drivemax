import { readFile } from "node:fs/promises";
import pg from "pg";

// Production builds apply this additive migration before moving the live alias.
// Never mutate a shared database from local or preview builds.
if (
  process.env.VERCEL_ENV === "production" &&
  process.env.CONTROL_ROOM_ENABLED === "true"
) {
  const connectionString =
    process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString)
    throw new Error(
      "Notification setup requires the production database connection.",
    );
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    query_timeout: 20000,
  });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '15s'");
    await client.query("select pg_advisory_xact_lock(76061019)");
    const existing = await client.query(
      "select to_regclass('public.lead_notifications') as notifications",
    );
    if (!existing.rows[0].notifications) {
      const sql = await readFile(
        new URL(
          "../supabase/migrations/202610190001_lead_notifications.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await client.query(sql.replace(/^begin;/m, "").replace(/^commit;/m, ""));
      console.log("Dealership notification outbox installed.");
    } else {
      console.log("Dealership notification outbox already installed.");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    // Provider errors can contain connection information; keep build logs generic.
    const code =
      typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "UNKNOWN";
    console.error(
      `Notification database setup failed (${code}); production deployment stopped.`,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
