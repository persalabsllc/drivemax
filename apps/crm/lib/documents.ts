import manifest from "../assets/forms/manifest.json";
import {
  dayKey,
  opportunityOpen,
  quoteMath,
  type Workspace,
  type Customer,
  type Opportunity,
} from "./model";
import {
  personFromCustomer,
  fullName,
  mailingAddress,
  type Person,
} from "./people";
export type PaperValues = Record<string, string | boolean>;
export type Paperwork = Record<string, PaperValues>;
export type FormField = {
  name: string;
  label: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  key?: string;
  multiline?: boolean;
  radioGroup?: string;
  exportValue?: string;
  exclusiveGroup?: string;
  section?: number;
  defaultValue?: string | boolean;
};
export const fieldKey = (f: FormField) =>
  f.radioGroup ? f.name + "::" + f.exportValue : f.name;
export type FormTemplate = {
  id: string;
  title: string;
  file: string;
  pages: { width: number; height: number; fields: FormField[] }[];
};
export const soldForms = manifest.forms as FormTemplate[];
export const mvr2Form = manifest.mvr2 as FormTemplate;
export const allForms = [...soldForms, mvr2Form];
const join = (...parts: unknown[]) =>
  parts.filter((v) => v !== null && v !== undefined && v !== "").join(" ");
const date = (v: string | null | undefined) =>
  v ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : "";
const dollars = (v: number | null | undefined) =>
  v == null ? "" : v.toFixed(2);
export function documentContext(
  ws: Workspace,
  customer: Customer,
  o: Opportunity,
): PaperValues {
  const closed = !opportunityOpen(o),
    c = closed ? (o.sale_snapshot?.customer ?? customer) : customer,
    p = personFromCustomer(c),
    co = c.co_buyer;
  const q = closed
    ? o.sale_snapshot?.quote
    : ws.quotes
        .filter(
          (q) =>
            q.opportunity_id === o.id &&
            (q.inventory_id ?? null) === o.inventory_id &&
            (o.inventory_id || q.vehicle === o.vehicle_interest),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const v =
    q?.vehicle_details ??
    (!closed && o.inventory_id
      ? ws.inventory.find((v) => v.id === o.inventory_id)
      : null) ??
    o.vehicle_details;
  const trade = q?.trade_snapshot ?? o.trade,
    insurance = closed ? o.sale_snapshot?.insurance : c.insurance;
  const out: PaperValues = {};
  function person(prefix: string, p: Person) {
    const m = mailingAddress(p),
      address = join(p.address1, p.address2),
      mail = join(m.address1, m.address2);
    Object.assign(out, {
      [prefix + ".name"]: fullName(p),
      [prefix + ".address"]: address,
      [prefix + ".full_address"]: join(address, p.city, p.state, p.zip),
      [prefix + ".city"]: p.city,
      [prefix + ".state"]: p.state,
      [prefix + ".zip"]: p.zip,
      [prefix + ".county"]: p.county,
      [prefix + ".phone"]: p.phone,
      [prefix + ".email"]: p.email,
      [prefix + ".license_number"]: join(p.license_number, p.license_state),
      [prefix + ".residence_address"]: address,
      [prefix + ".residence_city"]: p.city,
      [prefix + ".residence_state"]: p.state,
      [prefix + ".residence_zip"]: p.zip,
      [prefix + ".residence_city_state"]: join(p.city, p.state),
      [prefix + ".mailing_address"]: mail,
      [prefix + ".mailing_city"]: m.city,
      [prefix + ".mailing_state"]: m.state,
      [prefix + ".mailing_zip"]: m.zip,
      [prefix + ".full_mailing_address"]: join(mail, m.city, m.state, m.zip),
    });
  }
  person("buyer", p);
  if (co) person("co_buyer", co);
  Object.assign(out, {
    "buyers.names": join(fullName(p), co ? "& " + fullName(co) : ""),
    "dealer.name": "DRIVE MAX USED CARS LLC",
    "dealer.address": "6210 Old US Hwy 70 W",
    "dealer.city": "New Bern",
    "dealer.state": "NC",
    "dealer.zip": "28562",
    "dealer.full_address": "6210 Old US Hwy 70 W, New Bern, NC 28562",
    "dealer.name_address":
      "DRIVE MAX USED CARS LLC\n6210 Old US Hwy 70 W, New Bern, NC 28562",
    "deal.number": o.id.slice(0, 8).toUpperCase(),
    "deal.date": date(o.sold_on || dayKey()),
    "deal.delivery_date": date(o.sold_on),
    "vehicle.year": String(v?.year ?? ""),
    "vehicle.make": v?.make ?? "",
    "vehicle.model_trim": v ? join(v.model, v.trim) : o.vehicle_interest,
    "vehicle.vin": v?.vin ?? "",
    "vehicle.mileage": String(v?.mileage ?? ""),
    "vehicle.stock_number": v?.stock_number ?? "",
    "vehicle.color": v?.color ?? "",
    "vehicle.condition": "Used",
  });
  if (trade)
    Object.assign(out, {
      "trade.year": String(trade.year ?? ""),
      "trade.make": trade.make,
      "trade.model_trim": join(trade.model, trade.trim),
      "trade.make_model": join(trade.make, trade.model, trade.trim),
      "trade.vin": trade.vin,
      "trade.mileage": String(trade.mileage),
      "trade.payoff_quote_amount": dollars(trade.payoff),
    });
  if (insurance)
    Object.assign(out, {
      "insurance.company": insurance.company,
      "insurance.agent": insurance.agent,
      "insurance.phone": insurance.agent_phone,
      "insurance.email": insurance.agent_email,
      "insurance.agency_address": insurance.agent_address,
      "insurance.policy_number": insurance.policy_number,
      "insurance.effective_from": date(insurance.effective_from),
      "insurance.effective_to": date(insurance.effective_to),
      "insurance.collision_deductible": dollars(insurance.collision_deductible),
      "insurance.comprehensive_deductible": dollars(
        insurance.comprehensive_deductible,
      ),
    });
  if (q) {
    const f = q.values,
      m = quoteMath(f);
    Object.assign(out, {
      "deal.is_cash": f.mode === "cash",
      "deal.is_finance": f.mode !== "cash",
      "deal.price": dollars(f.price),
      "deal.doc_fee": dollars(f.docFee),
      "deal.add_ons": dollars(f.addOns ?? 0),
      "deal.service_contract": dollars(f.serviceContract ?? 0),
      "deal.optional_products_total": dollars(f.serviceContract ?? 0),
      "deal.tax": dollars(m.tax),
      "deal.other_taxes": dollars(f.otherTaxes ?? 0),
      "deal.title_fee": dollars(f.titleFee),
      "deal.trade_allowance": dollars(f.tradeAllowance),
      "deal.payoff": dollars(f.payoff),
      "deal.trade_difference": dollars(f.price - f.tradeAllowance),
      "deal.net_trade_equity": dollars(f.tradeAllowance - f.payoff),
      "deal.taxable_subtotal": dollars(f.price + f.docFee + (f.addOns ?? 0)),
      "deal.taxable_base": dollars(m.taxBase),
      "deal.vehicle_after_trade": dollars(
        f.price + f.docFee + (f.addOns ?? 0) - f.tradeAllowance,
      ),
      "deal.total_fees": dollars(m.tax + f.titleFee + (f.otherTaxes ?? 0)),
      "deal.net_sale_total": dollars(m.total - f.payoff),
      "deal.down_payment": dollars(f.downPayment),
      "deal.balance": dollars(m.balance),
      "deal.amount_financed":
        f.mode === "cash" ? "" : dollars(Math.max(0, m.balance)),
      "deal.payment_method": f.mode === "cash" ? "Cash" : "Finance",
    });
  }
  return out;
}
export function formValues(
  form: FormTemplate,
  context: PaperValues,
  paperwork: Paperwork,
  section = 1,
): PaperValues {
  const common = { ...context, ...paperwork.$common },
    out: PaperValues = {};
  for (const f of form.pages.flatMap((p) => p.fields)) {
    if (f.section && f.section !== section) {
      out[fieldKey(f)] = f.type === "checkbox" ? false : "";
      continue;
    }
    let value = f.key ? common[f.key] : undefined;
    if (form.id === "MVR-2" && f.section) {
      const prop = f.name.split(".").at(-1);
      if (prop === "buyer_name_address")
        value = join(common["buyers.names"], common["buyer.full_address"]);
      if (prop === "mileage") value = common["vehicle.mileage"];
      if (prop === "delivered_on") value = common["deal.date"];
      if (prop === "dealer_name") value = common["dealer.name"];
      if (prop === "dealer_number") value = common["dealer.number"];
    }
    out[fieldKey(f)] =
      paperwork[form.id]?.[fieldKey(f)] ??
      value ??
      f.defaultValue ??
      (f.type === "checkbox" ? false : "");
  }
  return out;
}
export const sharedPrintFields = [
  ["insurance.policy_number", "Insurance policy number"],
  ["insurance.company", "Insurance company"],
  ["insurance.agent", "Insurance agent"],
  ["insurance.phone", "Agent phone"],
  ["insurance.effective_from", "Policy effective date"],
  ["insurance.effective_to", "Policy expiration date"],
  ["insurance.collision_deductible", "Collision deductible"],
  ["insurance.comprehensive_deductible", "Comprehensive deductible"],
  ["dealer.number", "Dealer license number"],
  ["dealer.representative", "Salesperson / dealer representative"],
  ["vehicle.body", "Vehicle body style"],
  ["vehicle.fuel", "Vehicle fuel"],
  ["lienholder.name", "Purchase lienholder"],
  ["lienholder.address", "Lienholder address"],
  ["lienholder.city", "Lienholder city"],
  ["lienholder.state", "Lienholder state"],
  ["lienholder.zip", "Lienholder ZIP"],
  ["lienholder.id", "Lienholder ID"],
  ["lienholder.account", "Lienholder account"],
  ["lienholder.date", "Lien date"],
  ["trade.lienholder", "Trade payoff lender"],
  ["trade.account_number", "Trade payoff account"],
  ["trade.payoff_address", "Trade payoff mailing address"],
  ["trade.lender_phone", "Trade lender phone"],
  ["trade.payoff_good_through", "Payoff good through"],
] as const;
