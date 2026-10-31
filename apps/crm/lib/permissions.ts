// Keep deal access separate from dealership administration.
export const staffRoles = ["owner", "manager", "finance", "sales"] as const;
export type StaffRole = (typeof staffRoles)[number];
export const roleLabel = (role: string) =>
  ({
    owner: "Dealership owner",
    manager: "Manager",
    finance: "Finance Manager",
    sales: "Salesperson",
  })[role] ?? "No access";
export const canManage = (role: string) =>
  role === "owner" || role === "manager";
export const canDesk = (role: string) => canManage(role) || role === "finance";

export function canAccessView(role: string, view: string) {
  if (!staffRoles.includes(role as StaffRole)) return false;
  if (
    [
      "Accounting",
      "Sales reports",
      "Management reports",
      "Service",
      "Trade-ins",
      "Money owed",
      "Appraisals",
    ].includes(view)
  )
    return canManage(role);
  if (["Desking", "F&I Products"].includes(view)) return canDesk(role);
  return true;
}

// Explicit grants fail closed when new command types are added. Record ownership
// and assignment checks still run in the individual command handlers.
export const staffCommands = [
  "save_profile_name",
  "save_email_signature",
  "set_email_opt_out",
  "pause_customer_workflows",
  "save_deal_progress",
  "save_buyer_preferences",
  "save_title_amounts",
  "save_title_case",
  "save_temp_tag",
  "attach_title_document",
  "save_appointment",
  "set_appointment_status",
  "review_attention",
  "save_message",
  "delete_message_draft",
  "create_opportunity",
  "update_opportunity",
  "close_opportunity",
  "save_insurance",
  "save_paperwork",
  "create_customer",
  "update_customer",
  "set_co_buyer",
  "add_activity",
  "check_in",
  "check_out",
  "mark_sold",
  "create_task",
  "complete_task",
] as const;
export const financeCommands = [
  "save_quote",
  "convert_quick_quote",
  "convert_quick_quote_existing",
  "issue_protection_batch",
  "issue_protection",
  "cancel_protection",
  "record_protection_claim",
  "record_protection_refund",
  "submit_protection_claim",
  "update_protection_claim",
  "pay_protection_claim",
  "close_protection_claim",
] as const;
export function canRunCommand(
  role: string,
  command: { type: string; [key: string]: unknown },
) {
  if (canManage(role)) return true;
  if (role !== "sales" && role !== "finance") return false;
  if (!canDesk(role) && command.type === "save_message" && command.quote_id)
    return false;
  return (
    (staffCommands as readonly string[]).includes(command.type) ||
    (canDesk(role) &&
      (financeCommands as readonly string[]).includes(command.type))
  );
}

// Unclassified dealer documents may contain invoices, ACV or deal recaps.
// Sales staff retain access to their assigned customer's ID/insurance/stips.
export const salesDocumentKinds = [
  "insurance",
  "identification",
  "stipulation",
];
export function canReadDealFile(
  role: string,
  file: { kind: string; opportunity_id?: string | null },
) {
  return (
    canManage(role) ||
    (Boolean(file.opportunity_id) &&
      (canDesk(role) ||
        (role === "sales" && salesDocumentKinds.includes(file.kind))))
  );
}
