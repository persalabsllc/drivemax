import "server-only";
import { db } from "./server";
import { readWorkspaceRecords } from "./workspace-records";
import { buildManagementReport, type ReportRun } from "./management-reports";
import type { Workspace } from "./model";

/** Generates private CRM inbox snapshots. It never sends customer or staff email. */
export async function dispatchReports(orgId?: string) {
  if (process.env.VERCEL_ENV !== "production") return true;
  const d = db();
  const { data: jobs, error } = await d.rpc("dmcrm_claim_reports", {
    p_org: orgId ?? null,
  });
  if (error) return false;
  let ok = true;
  for (const job of (jobs ?? []) as (ReportRun & { lease_id: string })[]) {
    try {
      const { data: org, error: orgError } = await d
        .from("dmcrm_orgs")
        .select("id,name,slug")
        .eq("id", job.org_id)
        .single();
      const { data: report, error: reportError } = await d
        .from("dmcrm_saved_reports")
        .select("created_by")
        .eq("id", job.report_id)
        .eq("org_id", job.org_id)
        .single();
      if (orgError || reportError || !org || !report) throw Error("source");
      const { data: staff, error: staffError } = await d
        .from("dmcrm_staff")
        .select("id,user_id,name,role")
        .eq("org_id", job.org_id)
        .eq("user_id", report.created_by)
        .eq("active", true)
        .single();
      if (staffError || !staff) throw Error("access");
      const records = await readWorkspaceRecords(d, {
        org_id: job.org_id,
        staff_id: staff.id,
        role: "manager",
      });
      const ws = {
        ...records,
        org,
        member: {
          id: staff.user_id,
          staff_id: staff.id,
          name: staff.name,
          role: "manager",
        },
      } as Workspace;
      const snapshot = buildManagementReport(ws, job.definition, job.name);
      const result = await d.rpc("dmcrm_finish_report", {
        p_id: job.id,
        p_lease: job.lease_id,
        p_snapshot: snapshot,
        p_error: "",
      });
      if (result.error) throw Error("finish");
    } catch {
      ok = false;
      await d.rpc("dmcrm_finish_report", {
        p_id: job.id,
        p_lease: job.lease_id,
        p_snapshot: null,
        p_error:
          "Report could not be generated. It will retry up to three times; use Generate now to create a fresh run.",
      });
    }
  }
  return ok;
}
