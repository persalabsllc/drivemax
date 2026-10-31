import { createClient } from "@supabase/supabase-js";
import { pricingConfigSchema, protectionCost } from "../lib/protection-pricing";
import {
  readWorkspaceRecords,
  workspaceTables,
} from "../lib/workspace-records";

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
      .select("id,org_id,user_id,name,first_name,last_name")
      .eq("org_id", "d5a1c100-0000-4000-8000-000000000001")
      .eq("role", "owner")
      .eq("active", true)
      .limit(1)
      .single();
    if (error || !staff)
      throw new Error("Workspace verification owner unavailable");
    const { data: member, error: memberError } = await d
      .from("dmcrm_members")
      .select("name")
      .eq("org_id", staff.org_id)
      .eq("user_id", staff.user_id)
      .single();
    if (
      memberError ||
      member?.name !== staff.name ||
      (staff.first_name &&
        staff.last_name &&
        staff.name !== `${staff.first_name} ${staff.last_name}`)
    )
      throw new Error("Workspace owner name is inconsistent");
    console.log(
      "Verified production owner name agrees across staff and membership.",
    );
    for (const role of ["owner", "sales"] as const) {
      let records: Awaited<ReturnType<typeof readWorkspaceRecords>> | undefined;
      for (let attempt = 0; attempt < 11; attempt++) {
        try {
          records = await readWorkspaceRecords(d, {
            org_id: staff.org_id,
            staff_id: staff.id,
            role,
          });
          break;
        } catch (error) {
          // Only a missing table in the API schema cache is transient after a
          // migration. Column/permission/query errors must still fail release.
          if (
            !(error instanceof Error) ||
            !error.message.includes("PGRST205") ||
            attempt === 10
          )
            throw error;
          console.log("Waiting for database API schema refresh.");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (!records) throw new Error("Workspace read result incomplete");
      if (workspaceTables.some((table) => !Array.isArray(records[table])))
        throw new Error("Workspace read result incomplete");
      if (
        role === "sales" &&
        (records.protection_claims?.length ||
          records.protection_claim_events?.length)
      )
        throw new Error("Claim records escaped manager-only access");
      if (role === "owner") {
        const totals = new Map<string, number>();
        for (const claim of records.protection_claims ?? [])
          if (claim.status === "paid")
            totals.set(
              claim.contract_id,
              (totals.get(claim.contract_id) ?? 0) +
                Math.round(Number(claim.amount) * 100),
            );
        for (const contract of records.protection_contracts ?? [])
          if (
            (totals.get(contract.id) ?? 0) !==
            Math.round(Number(contract.claims_paid) * 100)
          )
            throw new Error(
              "Claim tracking does not reconcile to contract payments",
            );
        console.log(
          "Verified paid-claim tracking reconciles to contract payments.",
        );
      }
      const pricing = records.product_pricing?.[0];
      if (role === "owner" && pricing?.active && pricing.active_revision) {
        const config = pricingConfigSchema.parse(pricing.active);
        const example = {
          protection_plan: "deluxe" as const,
          term_months: 6,
          mileage_limit: 6000,
          price: 399.5,
        };
        const zero = protectionCost(
          { ...example, deductible: 0 },
          config,
          pricing.active_revision,
        );
        const fiveHundred = protectionCost(
          { ...example, deductible: 500 },
          config,
          pricing.active_revision,
        );
        if (!zero || !fiveHundred)
          throw new Error("Live protection pricing is incomplete");
        console.log(
          `Verified live protection pricing revision ${pricing.active_revision}: six-month Deluxe calculated cost $${zero.scheduled_cost.toFixed(2)} at $0 deductible; $${fiveHundred.scheduled_cost.toFixed(2)} at $500 deductible.`,
        );
      }
    }
    console.log(
      `Verified production workspace REST reads: ${workspaceTables.length} tables with owner and salesperson filters.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Workspace verification failed",
    );
    process.exitCode = 1;
  }
}
void main();
