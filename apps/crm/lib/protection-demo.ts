import { canManage, dayKey, type Command, type Workspace } from "./model";
import {
  protectionExpiry,
  protectionRefund,
  protectionIssuer,
  protectionEdition,
  validateProtectionBatch,
  validateProtectionClaim,
  protectionMoney,
  validateProtectionSource,
  type ProtectionCommand,
  type ProtectionContract,
} from "./protection";
export function demoProtection(
  ws: Workspace,
  command: Command,
  now: Date,
  batchId?: string,
): Workspace | null {
  if (
    ![
      "issue_protection",
      "issue_protection_batch",
      "cancel_protection",
      "record_protection_claim",
      "record_protection_refund",
    ].includes(command.type)
  )
    return null;
  if (!canManage(ws.member.role)) throw Error("Manager access required");
  const p = command as ProtectionCommand;
  const prior = ws.protection_events?.find((e) => e.id === p.request_id);
  if (prior) {
    if (
      prior.org_id !== ws.org.id ||
      prior.created_by !== ws.member.id ||
      JSON.stringify(prior.command) !== JSON.stringify(p)
    )
      throw Error("Use a new request key for changed details.");
    return ws;
  }
  if (p.type === "issue_protection_batch") {
    if (ws.protection_contracts?.some((c) => c.batch_id === p.id))
      throw Error("This product already has a contract.");
    validateProtectionBatch(ws, p);
    let state = structuredClone(ws);
    for (const item of p.contracts)
      state = demoProtection(
        state,
        {
          type: "issue_protection",
          id: item.id,
          request_id: item.id,
          contract: item.contract,
        },
        now,
        p.id,
      )!;
    state.protection_events!.unshift({
      id: p.request_id,
      org_id: state.org.id,
      contract_id: p.contracts[0].id,
      action: p.type,
      command: p,
      result: { batch_id: p.id, contract_ids: p.contracts.map((c) => c.id) },
      created_by: state.member.id,
      created_at: now.toISOString(),
    });
    return state;
  }
  const s = structuredClone(ws),
    today = dayKey(now),
    at = now.toISOString();
  s.protection_contracts ??= [];
  s.protection_events ??= [];
  let c = s.protection_contracts.find((c) => c.id === p.id);
  if (p.type === "issue_protection") {
    if (c) throw Error("This product already has a contract.");
    validateProtectionSource(s, p.contract);
    if (p.contract.issued_on > today)
      throw Error("Contract dates or mileage are invalid.");
    c = {
      ...p.contract,
      id: p.id,
      org_id: s.org.id,
      contract_number: `DMP-${String(s.protection_contracts.length + 1).padStart(7, "0")}`,
      expires_on: protectionExpiry(
        p.contract.issued_on,
        p.contract.term_months,
      ),
      expires_miles:
        p.contract.term_miles === null
          ? null
          : p.contract.start_miles + p.contract.term_miles,
      batch_id: batchId ?? null,
      status: "active",
      terms_version: protectionEdition(p.contract.plan),
      issuer: protectionIssuer,
      claims_paid: 0,
      cancellation: null,
      revision: 1,
      created_at: at,
      created_by: s.member.id,
    };
    s.protection_contracts.unshift(c);
  } else {
    if (!c) throw Error("Contract unavailable.");
    if (c.revision !== p.revision)
      throw Error("Contract changed. Refresh before continuing.");
    if (p.type === "record_protection_refund") {
      if (
        !c.cancellation ||
        c.cancellation.paid_on ||
        c.cancellation.refund <= 0
      )
        throw Error("Refund has already been recorded or no refund is due.");
      if (p.paid_on < c.cancellation.canceled_on || p.paid_on > today)
        throw Error("Contract dates or mileage are invalid.");
      c.cancellation.paid_on = p.paid_on;
      c.cancellation.payment_reference = p.reference;
    } else {
      if (c.status === "canceled") throw Error("Contract is already canceled.");
      if (p.type === "record_protection_claim") {
        validateProtectionClaim(c, p, s.protection_events, today);
        c.claims_paid = protectionMoney(c.claims_paid + p.amount);
      } else {
        if (p.canceled_on > today)
          throw Error("Contract dates or mileage are invalid.");
        c.cancellation = {
          ...protectionRefund(c, p.canceled_on, p.mileage),
          canceled_on: p.canceled_on,
          mileage: p.mileage,
          reason: p.reason,
          payee: p.payee,
          paid_on: null,
          payment_reference: "",
        };
        c.status = "canceled";
      }
    }
    c.revision++;
  }
  s.protection_events.unshift({
    id: p.request_id,
    org_id: s.org.id,
    contract_id: c.id,
    action: p.type,
    command: p,
    result: structuredClone(c) as unknown as Record<string, unknown>,
    created_by: s.member.id,
    created_at: at,
  });
  return s;
}
