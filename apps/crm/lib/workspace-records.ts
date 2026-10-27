import type {SupabaseClient} from "@supabase/supabase-js";
import {canManage,type Workspace} from "./model";
export type WorkspaceScope={org_id:string;staff_id:string;role:Workspace["member"]["role"]};
export const workspaceTables = [
    "customers",
    "visits",
    "activities",
    "tasks",
    "quotes",
    "inventory",
    "opportunities",
    "staff",
    "sales",
    "trades",
    "commissions",
    "messages",
    "appointments",
    "email_templates",
    "workflow_rules",
    "workflow_jobs",
    "workflow_pauses",
    "deal_progress",
    "buyer_preferences",
    "inventory_prep",
    "sales_events",
    "deal_files",
  ] as const;
export type WorkspaceRecords=Pick<Workspace,(typeof workspaceTables)[number]>;
export async function readWorkspaceRecords(d:SupabaseClient,s:WorkspaceScope):Promise<WorkspaceRecords>{
  // Pages are fetched fully in batches; never silently truncate the customer book.
  async function all(table: string) {
    if (table === "trades" && !canManage(s.role)) return [];
    const rows: unknown[] = [];
    for (let start = 0; ; start += 1000) {
      let query = d
        .from("dmcrm_" + table)
        .select(
          table === "sales" && !canManage(s.role)
            ? "id,org_id,opportunity_id,customer_id,sold_on,status,unwound_at,unwind_reason"
            : table === "staff" && !canManage(s.role)
              ? "id,org_id,user_id,name,email,role,active,created_at"
              : table === "deal_files"
                ? "id,org_id,customer_id,opportunity_id,name,kind,size,created_at,created_by"
                : table === "workflow_jobs"
                  ? "id,org_id,rule_id,customer_id,opportunity_id,appointment_id,event,run_at,state,reason,message_id,task_id,created_at"
                  : "*",
        )
        .eq("org_id", s.org_id);
      if (table === "inventory" || table === "trades")
        query = query.is("deleted_at", null);
      // Never deliver another salesperson's tasks to the browser, exports, or planner.
      if (table === "tasks" && !canManage(s.role))
        query = query.eq("assigned_to", s.staff_id);
      if (table === "commissions" && !canManage(s.role))
        query = query.eq("staff_id", s.staff_id);
      const { data, error } = await query.order(table === "workflow_pauses" ? "customer_id" : "id").range(start, start + 999);
      if (error) throw new Error(`CRM records unavailable (${table}: ${error.code || "unknown"})`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }
 const rows=await Promise.all(workspaceTables.map(all));
 return Object.fromEntries(workspaceTables.map((t,i)=>[t,rows[i]])) as WorkspaceRecords;
}
