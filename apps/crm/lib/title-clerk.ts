import { z } from "zod";
import type { Workspace } from "./model";

export const titleStatuses = {
  sold: "Deal sold",
  ready: "Ready for DMV",
  at_dmv: "At DMV",
  pending: "Pending",
  complete: "Complete",
} as const;
export const titleChecks = {
  title_received: "Title / ownership documents received",
  buyer_signatures: "Buyer signatures checked",
  title_application: "Title application prepared",
  power_of_attorney: "Power of attorney prepared",
  damage_disclosure: "Damage disclosure prepared",
  odometer_disclosure: "Odometer disclosure prepared",
  bill_of_sale: "Bill of sale prepared",
  insurance_verified: "Insurance verified",
  lienholder_verified: "Lienholder information checked",
  fees_verified: "DMV fees checked",
  dmv_receipt: "DMV receipt filed",
  transfer_verified: "Title / registration completion verified",
} as const;
export const titleDocumentPurposes = {
  dmv_receipt: "DMV receipt",
  transfer_proof: "Proof of title / registration transfer",
  temp_tag: "Temporary tag copy",
  supporting: "Supporting paperwork",
} as const;
export const dmvForms = [
  { id: "MVR-1", label: "Title application", detail: "MVR-1" },
  { id: "MVR-63", label: "Power of attorney", detail: "MVR-63" },
  { id: "MVR-181", label: "Damage disclosure", detail: "MVR-181" },
  { id: "MVR-180", label: "Odometer disclosure", detail: "MVR-180" },
  { id: "bill-of-sale", label: "Bill of sale", detail: "Deal copy" },
] as const;
export type TitleStatus = keyof typeof titleStatuses;
export type TitleCheck = keyof typeof titleChecks;
export type CheckState = "todo" | "done" | "not_needed";
export type TitlePurpose = keyof typeof titleDocumentPurposes;
export type TitleCase = {
  id: string;
  org_id: string;
  sale_id: string;
  opportunity_id: string;
  customer_id: string;
  sold_on: string;
  customer_name: string;
  vehicle_label: string;
  stock_number: string;
  vin: string;
  status: TitleStatus;
  checklist: Partial<Record<TitleCheck, CheckState>>;
  notes: string;
  pending_reason: string;
  next_action_on: string | null;
  ready_on: string | null;
  submitted_on: string | null;
  completed_on: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type TempTag = {
  id: string;
  org_id: string;
  case_id: string;
  number: string;
  issued_on: string;
  expires_on: string;
  status: "active" | "permanent" | "replaced" | "void";
  closed_on: string | null;
  notes: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
export const tagStatuses = {
  active: "Assigned",
  permanent: "Permanent registration received",
  replaced: "Replaced",
  void: "Void",
} as const;
export type TitleDocument = {
  id: string;
  org_id: string;
  case_id: string;
  file_id: string;
  purpose: TitlePurpose;
  created_at: string;
};
export type TitleEvent = {
  id: string;
  org_id: string;
  case_id: string;
  event: string;
  actor_name: string;
  detail: Record<string, unknown>;
  created_at: string;
};
const date = z.iso.date().nullable();
export const titleCaseValues = z.object({
  status: z.enum(["sold", "ready", "at_dmv", "pending", "complete"]),
  checklist: z.partialRecord(
    z.enum(Object.keys(titleChecks) as [TitleCheck, ...TitleCheck[]]),
    z.enum(["todo", "done", "not_needed"]),
  ),
  notes: z.string().trim().max(4000),
  pending_reason: z.string().trim().max(1000),
  next_action_on: date,
  ready_on: date,
  submitted_on: date,
  completed_on: date,
});
export const tempTagValues = z.object({
  number: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(40)
    .regex(
      /^[A-Z0-9]+(-[A-Z0-9]+)*$/,
      "Use letters, numbers and hyphens for the tag number.",
    ),
  issued_on: z.iso.date(),
  expires_on: z.iso.date(),
  status: z.enum(["active", "permanent", "replaced", "void"]),
  closed_on: date,
  notes: z.string().trim().max(2000),
});
export const titleClerkCommands = [
  z.object({
    type: z.literal("save_title_case"),
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    values: titleCaseValues,
  }),
  z.object({
    type: z.literal("save_temp_tag"),
    id: z.uuid(),
    case_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    values: tempTagValues,
  }),
  z.object({
    type: z.literal("attach_title_document"),
    id: z.uuid(),
    file_id: z.uuid(),
    purpose: z.enum([
      "dmv_receipt",
      "transfer_proof",
      "temp_tag",
      "supporting",
    ]),
  }),
] as const;
export const titleErrors = [
  "Title case unavailable",
  "Unwound sale is read-only",
  "Enter a pending reason",
  "Resolve every checklist item before completing paperwork",
  "Check the DMV milestone dates",
  "Check the temporary tag dates (up to 60 days)",
  "This tag number is already recorded",
  "Close the current tag before recording another",
  "Closed tags cannot be reactivated",
  "Enter a reason for replacing or voiding a tag",
  "Document does not belong to this sale",
  "Document is already filed with another title case",
  "Invalid title clerk information",
] as const;
export function calendarDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      86400000,
  );
}
export function shiftDate(value: string, days: number): string {
  const d = new Date(value + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function titleAge(c: TitleCase, today: string): number {
  return Math.max(0, calendarDays(c.sold_on, c.completed_on ?? today));
}
export function checklistProgress(c: Pick<TitleCase, "checklist">) {
  const keys = Object.keys(titleChecks) as TitleCheck[];
  return {
    done: keys.filter(
      (k) => c.checklist[k] === "done" || c.checklist[k] === "not_needed",
    ).length,
    total: keys.length,
  };
}
export function tagTiming(tag: TempTag, today: string) {
  const days = calendarDays(today, tag.expires_on);
  return {
    days,
    expired: tag.status === "active" && days < 0,
    expiring: tag.status === "active" && days >= 0 && days <= 7,
  };
}
export function isActiveTitle(ws: Workspace, c: TitleCase) {
  return (
    ws.sales?.some((s) => s.id === c.sale_id && s.status === "sold") ?? false
  );
}
export function titleValues(c: TitleCase): z.infer<typeof titleCaseValues> {
  return {
    status: c.status,
    checklist: { ...c.checklist },
    notes: c.notes,
    pending_reason: c.pending_reason,
    next_action_on: c.next_action_on,
    ready_on: c.ready_on,
    submitted_on: c.submitted_on,
    completed_on: c.completed_on,
  };
}
export function titleValidation(
  c: Pick<TitleCase, "sold_on">,
  v: z.infer<typeof titleCaseValues>,
  today: string,
): string | null {
  if (v.status === "pending" && !v.pending_reason) return titleErrors[2];
  if (
    v.status === "complete" &&
    checklistProgress(v).done !== Object.keys(titleChecks).length
  )
    return titleErrors[3];
  if (
    [v.ready_on, v.submitted_on, v.completed_on].some(
      (d) => d && (d < c.sold_on || d > today),
    ) ||
    (v.ready_on && v.submitted_on && v.ready_on > v.submitted_on) ||
    (v.completed_on &&
      ((v.submitted_on && v.completed_on < v.submitted_on) ||
        (v.ready_on && v.completed_on < v.ready_on))) ||
    (v.status === "ready" && !v.ready_on) ||
    (v.status === "at_dmv" && !v.submitted_on) ||
    (v.status === "complete") !== !!v.completed_on
  )
    return titleErrors[4];
  return null;
}
