import manifest from "../assets/forms/manifest.json";
import type { Paperwork, FormTemplate } from "./documents";

export const fiCalculationKeys = [
  "price",
  "doc_fee",
  "add_ons",
  "service_contract",
  "gap",
  "prepaid_maintenance",
  "tire_wheel",
  "other_product_1_description",
  "other_product_1",
  "other_product_2_description",
  "other_product_2",
  "optional_products_total",
  "is_cash",
  "is_finance",
  "payment_method",
  "tax",
  "other_taxes",
  "title_fee",
  "trade_allowance",
  "payoff",
  "trade_difference",
  "net_trade_equity",
  "taxable_subtotal",
  "taxable_base",
  "vehicle_after_trade",
  "total_fees",
  "net_sale_total",
  "down_payment",
  "balance",
  "amount_financed",
].map((key) => "deal." + key);
export const fiPaperworkFields = Object.fromEntries(
  ([...manifest.forms, manifest.mvr2] as FormTemplate[]).map((form) => [
    form.id,
    form.pages
      .flatMap((p) => p.fields)
      .filter((f) => f.key && fiCalculationKeys.includes(f.key))
      .map((f) => (f.radioGroup ? `${f.name}::${f.exportValue}` : f.name)),
  ]),
);
export function clearFIPaperwork(paperwork: Paperwork = {}): Paperwork {
  return Object.fromEntries(
    Object.entries(paperwork).map(([form, values]) => [
      form,
      Object.fromEntries(
        Object.entries(values).filter(
          ([key]) =>
            !(
              form === "$common"
                ? fiCalculationKeys
                : (fiPaperworkFields[form] ?? [])
            ).includes(key),
        ),
      ),
    ]),
  );
}
