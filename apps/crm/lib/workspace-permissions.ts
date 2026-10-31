import type { Workspace } from "./model";
import { canDesk, canManage, canReadDealFile } from "./permissions";

export const managementTables = [
  "pricing_events",
  "protection_fund_entries",
  "trades",
  "service_orders",
  "service_receipts",
  "management_events",
  "saved_reports",
  "report_runs",
  "money_plans",
  "money_entries",
  "ad_spend",
  "business_events",
  "commissions",
  "sales_events",
  "appraisals",
  "workflow_rules",
  "workflow_jobs",
] as const;
export const deskingTables = [
  "product_pricing",
  "quotes",
  "protection_contracts",
  "protection_events",
  "protection_claims",
  "protection_claim_events",
  "inventory_prep",
] as const;
export function canReadWorkspaceTable(role: string, table: string) {
  if ((managementTables as readonly string[]).includes(table))
    return canManage(role);
  if ((deskingTables as readonly string[]).includes(table))
    return canDesk(role);
  return ["owner", "manager", "finance", "sales"].includes(role);
}

// Covers today's vehicle, customer mirrors and nested historical snapshots.
// Remove values rather than replacing them with misleading zero-dollar costs.
const privateFields = new Set([
  "cost",
  "recon",
  "acv",
  "vehicle_cost",
  "recon_cost",
  "internal_cost",
  "pricing_snapshot",
  "accounting",
  "quote",
  "paperwork",
]);
function withoutCosts<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutCosts) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !privateFields.has(key))
      .map(([key, v]) => [key, withoutCosts(v)]),
  ) as T;
}
export function restrictRecords<T extends Partial<Workspace>>(
  records: T,
  role: string,
  staffId: string | null,
): T {
  if (canManage(role)) return records;
  const result = { ...records } as Partial<Workspace>;
  for (const table of [...managementTables, ...deskingTables]) {
    if (!canReadWorkspaceTable(role, table) && table in result)
      result[table] = [];
  }
  result.staff = result.staff?.map(
    ({ id, org_id, user_id, name, email, role, active, created_at }) => ({
      id,
      org_id,
      user_id,
      name,
      email,
      role,
      active,
      created_at,
    }),
  );
  result.tasks = result.tasks?.filter((t) => t.assigned_to === staffId);
  result.sales = result.sales?.map((sale) => {
    const {
      id,
      org_id,
      opportunity_id,
      customer_id,
      sold_on,
      status,
      created_at,
      unwound_at,
      unwind_reason,
    } = sale;
    return {
      id,
      org_id,
      opportunity_id,
      customer_id,
      sold_on,
      status,
      created_at,
      unwound_at,
      unwind_reason,
    } as typeof sale;
  });
  const assigned = new Set(
    result.opportunities
      ?.filter((o) => o.assigned_to === staffId)
      .map((o) => o.id),
  );
  result.deal_files = result.deal_files?.filter(
    (f) =>
      canReadDealFile(role, f) &&
      (canDesk(role) || (f.opportunity_id && assigned.has(f.opportunity_id))),
  );
  if (!canDesk(role)) {
    result.customers = withoutCosts(result.customers);
    result.inventory = withoutCosts(result.inventory);
    result.opportunities = withoutCosts(result.opportunities);
  }
  return result as T;
}
export function restrictWorkspace(ws: Workspace): Workspace {
  const result = restrictRecords(
    ws,
    ws.member.role,
    ws.member.staff_id ?? null,
  );
  if (!canManage(ws.member.role)) {
    result.email_settings = undefined;
    result.website_inventory = [];
    result.workflow_health = undefined;
  }
  return result;
}
