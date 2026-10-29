import type { Command, Workspace } from "./model";
import { canManage, dayKey } from "./model";
import type { BusinessCommand, MoneyEntry } from "./business";
export function demoBusiness(
  ws: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (
    ![
      "save_money_plan",
      "record_money",
      "reverse_money",
      "save_ad_spend",
      "void_ad_spend",
    ].includes(command.type)
  )
    return null;
  const p = command as BusinessCommand;
  if (!canManage(ws.member.role)) throw Error("Manager access required");
  const old = ws.business_events?.find((e) => e.id === p.request_id);
  if (old) {
    if (JSON.stringify(old.payload) !== JSON.stringify(p))
      throw Error("Use a new request key for changed details.");
    return ws;
  }
  const next = structuredClone(ws),
    at = now.toISOString();
  next.money_plans ??= [];
  next.money_entries ??= [];
  next.ad_spend ??= [];
  next.business_events ??= [];
  let subject: string;
  if (
    p.type === "save_money_plan" ||
    p.type === "record_money" ||
    p.type === "reverse_money"
  ) {
    subject = p.sale_id;
    const sale = next.sales?.find((s) => s.id === p.sale_id),
      plan = next.money_plans.find((x) => x.id === p.sale_id);
    if (!sale || sale.status !== "sold")
      throw Error("Only sold deals can be updated in Money owed.");
    if ((plan?.revision ?? 0) !== p.revision)
      throw Error("Money records changed. Refresh before saving.");
    if (p.type === "save_money_plan") {
      const saved = {
        ...p.plan,
        id: p.sale_id,
        org_id: ws.org.id,
        revision: (plan?.revision ?? 0) + 1,
        updated_at: at,
        updated_by: ws.member.id,
      };
      next.money_plans = next.money_plans
        .filter((x) => x.id !== p.sale_id)
        .concat(saved);
    } else {
      if (!plan)
        throw Error("Review the expected amounts before recording receipts.");
      if (p.received_on > dayKey(now))
        throw Error("Receipt and spending dates cannot be in the future.");
      if (next.money_entries.some((e) => e.id === p.id))
        throw Error("Use a new request key for changed details.");
      let entry: MoneyEntry;
      const base = {
        id: p.id,
        org_id: ws.org.id,
        sale_id: p.sale_id,
        received_on: p.received_on,
        created_at: at,
        created_by: ws.member.id,
      };
      if (p.type === "record_money")
        entry = {
          ...base,
          kind: p.kind,
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          notes: p.notes,
          reversal_of: null,
        };
      else {
        const original = next.money_entries.find(
          (e) =>
            e.id === p.original_id && e.sale_id === p.sale_id && !e.reversal_of,
        );
        if (!original) throw Error("Receipt unavailable.");
        if (next.money_entries.some((e) => e.reversal_of === original.id))
          throw Error("This receipt has already been reversed.");
        entry = {
          ...base,
          kind: original.kind,
          amount: original.amount,
          method: original.method,
          reference: original.reference,
          notes: p.reason,
          reversal_of: original.id,
        };
      }
      next.money_entries.push(entry);
      plan.revision++;
      plan.updated_at = at;
      plan.updated_by = ws.member.id;
    }
  } else {
    subject = p.id;
    const existing = next.ad_spend.find((e) => e.id === p.id);
    if ((existing?.revision ?? 0) !== p.revision)
      throw Error("Advertising entry changed. Refresh before saving.");
    if (existing?.voided_at) throw Error("This advertising entry was voided.");
    if (p.type === "save_ad_spend") {
      if (p.spend.spent_on > dayKey(now))
        throw Error("Receipt and spending dates cannot be in the future.");
      next.ad_spend = next.ad_spend
        .filter((e) => e.id !== p.id)
        .concat({
          ...p.spend,
          source: p.spend.source.trim().replace(/\s+/g, " "),
          id: p.id,
          org_id: ws.org.id,
          revision: (existing?.revision ?? 0) + 1,
          voided_at: null,
          void_reason: "",
          created_at: existing?.created_at ?? at,
          updated_at: at,
        });
    } else {
      if (!existing)
        throw Error("Advertising entry changed. Refresh before saving.");
      existing.voided_at = at;
      existing.void_reason = p.reason;
      existing.updated_at = at;
      existing.revision++;
    }
  }
  next.business_events.push({
    id: p.request_id,
    org_id: ws.org.id,
    subject_id: subject,
    action: p.type,
    payload: { ...p },
    created_at: at,
    created_by: ws.member.id,
  });
  return next;
}
