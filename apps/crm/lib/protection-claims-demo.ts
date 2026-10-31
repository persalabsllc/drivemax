import { canManage, dayKey, type Command, type Workspace } from "./model";
import { demoProtection } from "./protection-demo";
import { validateClaimDetails, type ClaimCommand } from "./protection-claims";
export function demoClaims(
  ws: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (
    ![
      "submit_protection_claim",
      "update_protection_claim",
      "pay_protection_claim",
      "close_protection_claim",
    ].includes(command.type)
  )
    return null;
  if (!canManage(ws.member.role)) throw Error("Manager access required");
  const p = command as ClaimCommand;
  const prior = ws.protection_claim_events?.find((e) => e.id === p.request_id);
  if (prior) {
    if (
      prior.org_id !== ws.org.id ||
      prior.created_by !== ws.member.id ||
      JSON.stringify(prior.command) !== JSON.stringify(p)
    )
      throw Error("Use a new request key for changed details.");
    return ws;
  }
  if (ws.protection_events?.some((e) => e.id === p.request_id))
    throw Error("Use a new request key for changed details.");
  let s = structuredClone(ws);
  s.protection_claims ??= [];
  s.protection_claim_events ??= [];
  let claim = s.protection_claims.find(
    (c) => c.id === p.id && c.org_id === s.org.id,
  );
  const contractId =
    p.type === "submit_protection_claim" ? p.contract_id : claim?.contract_id;
  const c = s.protection_contracts?.find(
    (c) => c.id === contractId && c.org_id === s.org.id,
  );
  const today = dayKey(now),
    at = now.toISOString();
  if (!c)
    throw Error(
      p.type === "submit_protection_claim"
        ? "Contract unavailable."
        : "Claim unavailable.",
    );
  if (p.type === "submit_protection_claim") {
    if (claim) throw Error("This claim already exists.");
    if (c.status === "canceled") throw Error("Contract is already canceled.");
    validateClaimDetails(c, p.details, today);
    claim = {
      ...p.details,
      id: p.id,
      org_id: s.org.id,
      contract_id: c.id,
      claim_number: `DMC-${String(s.protection_claims.length + 1).padStart(7, "0")}`,
      status: "open",
      paid_on: null,
      amount: null,
      payment_reference: "",
      paid_from_fund: false,
      payment_event_id: null,
      closed_on: null,
      closure_reason: "",
      revision: 1,
      created_at: at,
      created_by: s.member.id,
      updated_at: at,
      updated_by: s.member.id,
    };
    s.protection_claims.unshift(claim);
  } else {
    if (!claim) throw Error("Claim unavailable.");
    if (claim.revision !== p.revision)
      throw Error("Claim changed. Refresh before continuing.");
    if (claim.status !== "open")
      throw Error("This claim is already paid or closed.");
    if (p.type === "update_protection_claim") {
      validateClaimDetails(c, p.details, today);
      Object.assign(claim, p.details);
    } else if (p.type === "close_protection_claim") {
      if (p.closed_on < claim.submitted_on || p.closed_on > today)
        throw Error("Claim dates, mileage or quantity are invalid.");
      Object.assign(claim, {
        status: "closed",
        closed_on: p.closed_on,
        closure_reason: p.reason,
      });
    } else {
      if (p.paid_on < claim.submitted_on)
        throw Error("Payment cannot precede claim submission.");
      s = demoProtection(
        s,
        {
          type: "record_protection_claim",
          id: c.id,
          request_id: p.request_id,
          revision: p.contract_revision,
          amount: p.amount,
          paid_on: p.paid_on,
          reference: p.reference,
          paid_from_fund: p.paid_from_fund,
          description: claim.description,
          service_on: claim.service_on!,
          mileage: claim.mileage!,
          units: claim.units,
        },
        now,
        undefined,
        false,
      )!;
      claim = s.protection_claims!.find((c) => c.id === p.id)!;
      Object.assign(claim, {
        status: "paid",
        paid_on: p.paid_on,
        amount: p.amount,
        payment_reference: p.reference,
        paid_from_fund: p.paid_from_fund,
        payment_event_id: p.request_id,
      });
    }
    Object.assign(claim, {
      revision: claim.revision + 1,
      updated_at: at,
      updated_by: s.member.id,
    });
  }
  s.protection_claim_events!.unshift({
    id: p.request_id,
    org_id: s.org.id,
    claim_id: claim.id,
    command: p,
    result: structuredClone(claim) as unknown as Record<string, unknown>,
    created_by: s.member.id,
    created_at: at,
  });
  return s;
}
