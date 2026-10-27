import { createClient } from "@supabase/supabase-js";
import { readWorkspaceRecords, workspaceTables } from "../lib/workspace-records";

// Exercise the same REST queries as the signed-in page after migrations. SQL-only
// checks cannot catch query/schema mismatches in the application loader.
async function main() {
  if (process.env.VERCEL_ENV !== "production") return;
  try {
    const d = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: staff, error } = await d
      .from("dmcrm_staff")
      .select("id,org_id")
      .eq("org_id", "d5a1c100-0000-4000-8000-000000000001")
      .eq("role", "owner")
      .eq("active", true)
      .limit(1)
      .single();
    if (error || !staff) throw new Error("Workspace verification owner unavailable");
    for (const role of ["owner", "sales"] as const) {
      const records = await readWorkspaceRecords(d, {
        org_id: staff.org_id,
        staff_id: staff.id,
        role,
      });
      if (workspaceTables.some((table) => !Array.isArray(records[table])))
        throw new Error("Workspace read result incomplete");
    }
    console.log(
      `Verified production workspace REST reads: ${workspaceTables.length} tables with owner and salesperson filters.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Workspace verification failed");
    process.exitCode = 1;
  }
}
void main();
