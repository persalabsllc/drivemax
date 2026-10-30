import { canManage, dayKey, type Command, type Workspace } from "./model";
import {
  type ServiceCommand,
  type ServiceOrder,
  type ServiceReceipt,
  serviceScope,
  serviceTotals,
  servicePaid,
  serviceLimitBasis,
} from "./service";
import {
  type ReportCommand,
  buildManagementReport,
  nextReportRun,
} from "./management-reports";

export function demoManagement(
  ws: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (
    ![
      "save_service_order",
      "authorize_service_order",
      "set_service_status",
      "record_service_receipt",
      "reverse_service_receipt",
      "apply_service_recon",
      "save_management_report",
      "queue_management_report",
    ].includes(command.type)
  )
    return null;
  if (!canManage(ws.member.role)) throw Error("Manager access required");
  const p = command as ServiceCommand | ReportCommand,
    old = ws.management_events?.find((e) => e.id === p.request_id);
  if (old) {
    if (JSON.stringify(old.command) !== JSON.stringify(p))
      throw Error("Use a new request key for changed details.");
    return ws;
  }
  const s = structuredClone(ws),
    at = now.toISOString();
  s.service_orders ??= [];
  s.service_receipts ??= [];
  s.saved_reports ??= [];
  s.report_runs ??= [];
  s.management_events ??= [];
  let subject: string;
  let before: Record<string, unknown> | null = null;
  if (p.type === "apply_service_recon") {
    subject = p.inventory_id;
    const v = s.inventory.find((i) => i.id === p.inventory_id);
    if (!v || !["in_stock", "pending"].includes(v.status))
      throw Error("Only available inventory recon can be updated.");
    if (v.updated_at !== p.expected_updated_at)
      throw Error("Record changed. Refresh before saving.");
    const orders = s.service_orders.filter(
      (o) =>
        o.inventory_id === v.id &&
        o.kind === "reconditioning" &&
        o.status === "completed",
    );
    if (!orders.length)
      throw Error("Complete a recon order before applying costs.");
    before = { ...v };
    v.recon = orders.reduce(
      (n, o) => n + (serviceTotals(o).actual ?? 0),
      p.other_costs,
    );
    v.updated_at = at;
  } else if (
    p.type === "save_management_report" ||
    p.type === "queue_management_report"
  ) {
    subject = p.id;
    const report = s.saved_reports.find((r) => r.id === p.id);
    if ((report?.revision ?? 0) !== p.revision)
      throw Error("Record changed. Refresh before saving.");
    before = report ? { ...report } : null;
    if (p.type === "save_management_report") {
      s.saved_reports = s.saved_reports
        .filter((r) => r.id !== p.id)
        .concat({
          id: p.id,
          org_id: s.org.id,
          name: p.name,
          definition: p.definition,
          schedule: p.schedule,
          archived: p.archived,
          revision: p.revision + 1,
          created_by: s.member.id,
          created_at: report?.created_at ?? at,
          updated_at: at,
          next_run_at: p.archived ? null : nextReportRun(p.schedule, now),
        });
    } else {
      if (!report || report.archived) throw Error("Record unavailable.");
      s.report_runs.unshift({
        id: p.run_id,
        org_id: s.org.id,
        report_id: report.id,
        report_revision: report.revision,
        name: report.name,
        definition: report.definition,
        scheduled_for: at,
        state: "completed",
        attempts: 1,
        snapshot: buildManagementReport(s, report.definition, report.name, now),
        error: "",
        created_at: at,
        completed_at: at,
      });
    }
  } else {
    subject = p.id;
    const o = s.service_orders.find((o) => o.id === p.id);
    if ((o?.revision ?? 0) !== p.revision)
      throw Error("Record changed. Refresh before saving.");
    if (
      o &&
      ["completed", "canceled"].includes(o.status) &&
      !["record_service_receipt", "reverse_service_receipt"].includes(p.type)
    )
      throw Error("Completed or canceled orders cannot be edited.");
    before = o ? structuredClone(o) : null;
    if (p.type === "save_service_order") {
      const v = p.order;
      if (
        (v.customer_id && !s.customers.some((c) => c.id === v.customer_id)) ||
        (v.opportunity_id &&
          !s.opportunities.some(
            (x) => x.id === v.opportunity_id && x.customer_id === v.customer_id,
          )) ||
        (v.inventory_id && !s.inventory.some((x) => x.id === v.inventory_id))
      )
        throw Error("Customer, deal, or vehicle link is invalid.");
      if (
        v.assigned_to &&
        !s.staff.some((st) => st.id === v.assigned_to && st.active)
      )
        throw Error("Select an active team member.");
      if (
        o &&
        servicePaid(s, o.id) &&
        (o.customer_id !== v.customer_id || o.kind !== v.kind)
      )
        throw Error("Reverse receipts before canceling.");
      const changed = o && serviceScope(o) !== serviceScope(v);
      const saved: ServiceOrder = {
        ...v,
        id: p.id,
        org_id: s.org.id,
        order_number:
          o?.order_number ??
          Math.max(0, ...s.service_orders.map((o) => o.order_number)) + 1,
        customer_name:
          s.customers.find((c) => c.id === v.customer_id)?.name ?? "",
        status:
          changed && o?.authorization
            ? "awaiting_approval"
            : (o?.status ?? "draft"),
        authorization: changed ? null : (o?.authorization ?? null),
        revision: p.revision + 1,
        created_at: o?.created_at ?? at,
        updated_at: at,
        completed_at: null,
        canceled_reason: "",
        created_by: o?.created_by ?? s.member.id,
      };
      s.service_orders = s.service_orders
        .filter((o) => o.id !== p.id)
        .concat(saved);
    } else {
      if (!o) throw Error("Record unavailable.");
      if (p.type === "authorize_service_order") {
        if (
          p.limit <
          Math.max(
            serviceLimitBasis(o),
            o.kind === "customer_pay" ? 0 : (serviceTotals(o).actual ?? 0),
          )
        )
          throw Error("Authorization must cover the estimate.");
        o.authorization = {
          by: p.by,
          method: p.method,
          limit: p.limit,
          notes: p.notes,
          at,
          actor: s.member.id,
        };
        if (["draft", "awaiting_approval"].includes(o.status))
          o.status = "approved";
      } else if (p.type === "set_service_status") {
        if (
          [
            "approved",
            "in_progress",
            "waiting_parts",
            "ready",
            "completed",
          ].includes(p.status) &&
          !o.authorization
        )
          throw Error("Record authorization before starting work.");
        if (p.status === "completed" && serviceTotals(o).actual === null)
          throw Error("Enter actual costs before completing the order.");
        if (
          p.status === "completed" &&
          (o.kind === "customer_pay"
            ? serviceTotals(o).total
            : serviceTotals(o).actual!) > o.authorization!.limit
        )
          throw Error(
            "Actual costs exceed the authorized budget. Record a new authorization.",
          );
        if (p.status === "canceled" && p.reason.trim().length < 3)
          throw Error("Enter a cancellation reason.");
        if (p.status === "canceled" && servicePaid(s, o.id))
          throw Error("Reverse receipts before canceling.");
        o.status = p.status;
        o.completed_at = p.status === "completed" ? at : null;
        o.canceled_reason = p.status === "canceled" ? p.reason : "";
        if (["draft", "awaiting_approval"].includes(p.status))
          o.authorization = null;
      } else {
        if (o.kind !== "customer_pay" || o.status === "canceled")
          throw Error("Receipts can only be recorded for customer-pay orders.");
        if (p.received_on > dayKey(now))
          throw Error("Receipt date cannot be in the future.");
        const base = {
          id: p.receipt_id,
          org_id: s.org.id,
          order_id: o.id,
          created_by: s.member.id,
          created_at: at,
          received_on: p.received_on,
        };
        let receipt: ServiceReceipt;
        if (p.type === "record_service_receipt")
          receipt = {
            ...base,
            amount: p.amount,
            method: p.method,
            reference: p.reference,
            notes: p.notes,
            reversal_of: null,
          };
        else {
          const original = s.service_receipts.find(
            (r) =>
              r.id === p.original_id && r.order_id === o.id && !r.reversal_of,
          );
          if (
            !original ||
            s.service_receipts.some((r) => r.reversal_of === original.id)
          )
            throw Error("Receipt unavailable or already reversed.");
          receipt = {
            ...base,
            amount: original.amount,
            method: original.method,
            reference: original.reference,
            notes: p.reason,
            reversal_of: original.id,
          };
        }
        s.service_receipts.push(receipt);
      }
      o.revision++;
      o.updated_at = at;
    }
  }
  s.management_events.push({
    id: p.request_id,
    org_id: s.org.id,
    subject_id: subject,
    action: p.type,
    command: { ...p },
    before_value: before,
    created_by: s.member.id,
    created_at: at,
  });
  return s;
}
