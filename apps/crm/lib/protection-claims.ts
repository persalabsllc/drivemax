import { z } from "zod";
import type { ProtectionContract, ProtectionEvent } from "./protection";

const date = z.iso.date();
const amount = z.number().finite().positive().max(1000000).multipleOf(0.01);
const details = z.object({
  submitted_on: date,
  service_on: date,
  mileage: z.number().int().min(0).max(6000000),
  units: z.number().int().min(1).max(2),
  description: z.string().trim().min(3).max(2000),
  repairer: z.string().trim().max(250),
  requested_amount: amount.nullable(),
});
const key = { id: z.uuid(), request_id: z.uuid() };
const revision = z.number().int().positive();
export const claimCommands = [
  z.object({
    type: z.literal("submit_protection_claim"),
    ...key,
    contract_id: z.uuid(),
    details,
  }),
  z.object({
    type: z.literal("update_protection_claim"),
    ...key,
    revision,
    details,
  }),
  z.object({
    type: z.literal("pay_protection_claim"),
    ...key,
    revision,
    contract_revision: revision,
    amount,
    paid_on: date,
    reference: z.string().trim().min(1).max(250),
    paid_from_fund: z.boolean(),
  }),
  z.object({
    type: z.literal("close_protection_claim"),
    ...key,
    revision,
    closed_on: date,
    reason: z.string().trim().min(3).max(1000),
  }),
] as const;
export type ClaimCommand = z.infer<(typeof claimCommands)[number]>;
export type ClaimDetails = z.infer<typeof details>;
export type ProtectionClaim = Omit<ClaimDetails, "service_on" | "mileage"> & {
  id: string;
  org_id: string;
  contract_id: string;
  claim_number: string;
  status: "open" | "paid" | "closed";
  service_on: string | null;
  mileage: number | null;
  paid_on: string | null;
  amount: number | null;
  payment_reference: string;
  paid_from_fund: boolean;
  payment_event_id: string | null;
  closed_on: string | null;
  closure_reason: string;
  revision: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
};
export type ClaimEvent = {
  id: string;
  org_id: string;
  claim_id: string;
  command: Record<string, unknown>;
  result: Record<string, unknown>;
  created_by: string;
  created_at: string;
};
export const claimErrors = [
  "Claim unavailable.",
  "Claim details are invalid.",
  "Claim changed. Refresh before continuing.",
  "This claim is already paid or closed.",
  "Claim dates, mileage or quantity are invalid.",
  "Payment cannot precede claim submission.",
  "This claim already exists.",
];
export function validateClaimDetails(
  c: ProtectionContract,
  d: ClaimDetails,
  today: string,
) {
  if (
    d.submitted_on < c.issued_on ||
    d.submitted_on > today ||
    d.service_on < c.issued_on ||
    d.service_on > d.submitted_on ||
    d.mileage < c.start_miles ||
    (c.plan !== "key_replacement" && d.units !== 1)
  )
    throw Error("Claim dates, mileage or quantity are invalid.");
}
// Legacy payments become tracking records only. Never replay the payment itself.
export function paidClaimFromEvent(
  e: ProtectionEvent,
  number: string,
): ProtectionClaim {
  const p = e.command;
  return {
    id: e.id,
    org_id: e.org_id,
    contract_id: e.contract_id,
    claim_number: number,
    status: "paid",
    submitted_on: String(p.paid_on),
    service_on: p.service_on ? String(p.service_on) : null,
    mileage: typeof p.mileage === "number" ? p.mileage : null,
    units: Number(p.units ?? 1),
    description: String(p.description),
    repairer: "",
    requested_amount: null,
    paid_on: String(p.paid_on),
    amount: Number(p.amount),
    payment_reference: String(p.reference),
    paid_from_fund: p.paid_from_fund === true,
    payment_event_id: e.id,
    closed_on: null,
    closure_reason: "",
    revision: 1,
    created_at: e.created_at,
    created_by: e.created_by,
    updated_at: e.created_at,
    updated_by: e.created_by,
  };
}
export type ClaimPeriod = "month" | "quarter" | "year";
export function claimPeriodRange(month: string, period: ClaimPeriod) {
  const [year, m] = month.split("-").map(Number);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw Error("Choose a valid month.");
  const startMonth =
    period === "year"
      ? 1
      : period === "quarter"
        ? Math.floor((m - 1) / 3) * 3 + 1
        : m;
  const length = period === "year" ? 12 : period === "quarter" ? 3 : 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, startMonth - 1 + length, 1))
    .toISOString()
    .slice(0, 10);
  return {
    start,
    end,
    label:
      period === "year"
        ? String(year)
        : period === "quarter"
          ? `Q${Math.floor((m - 1) / 3) + 1} ${year}`
          : new Date(start + "T12:00:00Z").toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }),
  };
}
export function claimPayoutSummary(
  claims: ProtectionClaim[],
  month: string,
  period: ClaimPeriod,
) {
  const range = claimPeriodRange(month, period);
  const paid = claims.filter(
    (c) =>
      c.status === "paid" &&
      c.paid_on &&
      c.paid_on >= range.start &&
      c.paid_on < range.end,
  );
  return {
    ...range,
    count: paid.length,
    amount:
      paid.reduce((sum, c) => sum + Math.round((c.amount ?? 0) * 100), 0) / 100,
  };
}
