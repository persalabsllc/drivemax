import type { Workspace } from "./model";
import { highwayUseTax, type FinanceValues } from "./finance";
import { isActiveTitle, type TitleCase } from "./title-clerk";

const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

/** Reviewed title amounts take priority; otherwise use the saved sale, never a later proposal. */
export function titleAmounts(ws: Workspace, record: TitleCase) {
  if (validAmount(record.amounts?.fees) && validAmount(record.amounts?.taxes)) {
    const fees = cents(record.amounts.fees) / 100,
      taxes = cents(record.amounts.taxes) / 100;
    return { fees, taxes, total: (cents(fees) + cents(taxes)) / 100 };
  }
  const sale = ws.sales?.find(
    (s) =>
      s.id === record.sale_id &&
      s.opportunity_id === record.opportunity_id &&
      s.customer_id === record.customer_id,
  );
  const opportunity = ws.opportunities.find(
    (o) =>
      o.id === record.opportunity_id && o.customer_id === record.customer_id,
  );
  // Sales staff receive the safe sale ledger without its accounting snapshot.
  // The closed opportunity is a valid fallback only for this same active sale.
  const quote = sale?.snapshot
    ? sale.snapshot.quote
    : sale?.status === "sold" && opportunity?.status === "sold"
      ? opportunity.sale_snapshot?.quote
      : null;
  const v = quote?.values;
  const fees = validAmount(v?.titleFee) ? cents(v.titleFee) / 100 : null;
  let tax: number | null = null;
  if (v?.taxMode === "auto") {
    if ([v.price, v.docFee, v.tradeAllowance, v.addOns ?? 0].every(validAmount))
      tax = highwayUseTax(v as FinanceValues);
  } else if (
    v &&
    (v.taxMode === "manual" || v.taxMode === undefined) &&
    validAmount(v.tax)
  )
    tax = v.tax;
  const other = v?.otherTaxes === undefined ? 0 : v.otherTaxes;
  const taxes =
    tax !== null && validAmount(other)
      ? (cents(tax) + cents(other)) / 100
      : null;
  return {
    fees,
    taxes,
    total:
      fees !== null && taxes !== null
        ? (cents(fees) + cents(taxes)) / 100
        : null,
  };
}

/** An unreviewed zero is visible, never silently treated as a verified amount. */
export function titleAmountsNeedReview(ws: Workspace, record: TitleCase) {
  const a = titleAmounts(ws, record);
  return (
    a.total === null || (!record.amounts && (a.fees === 0 || a.taxes === 0))
  );
}

export function pendingTitleTotals(
  ws: Workspace,
  cases = ws.title_cases ?? [],
) {
  const manager = ["owner", "manager"].includes(ws.member.role);
  const open = cases.filter(
    (c) =>
      c.status !== "complete" &&
      isActiveTitle(ws, c) &&
      (manager ||
        ws.opportunities.some(
          (o) =>
            o.id === c.opportunity_id && o.assigned_to === ws.member.staff_id,
        )),
  );
  let feeCents = 0,
    taxCents = 0,
    missingFees = 0,
    missingTaxes = 0,
    missingDeals = 0;
  for (const record of open) {
    const amounts = titleAmounts(ws, record);
    if (amounts.fees === null) missingFees++;
    else feeCents += cents(amounts.fees);
    if (amounts.taxes === null) missingTaxes++;
    else taxCents += cents(amounts.taxes);
    if (amounts.fees === null || amounts.taxes === null) missingDeals++;
  }
  const fees =
    open.length > 0 && missingFees === open.length ? null : feeCents / 100;
  const taxes =
    open.length > 0 && missingTaxes === open.length ? null : taxCents / 100;
  return {
    count: open.length,
    fees,
    taxes,
    total: fees === null && taxes === null ? null : (feeCents + taxCents) / 100,
    missingFees,
    missingTaxes,
    missingDeals,
  };
}
