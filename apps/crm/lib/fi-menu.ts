import { z } from "zod";
import {
  productSchema,
  productKinds,
  productsTotal,
  sum,
  type FIProduct,
} from "./operations";
import { calculateQuote, type FinanceValues } from "./finance";

export const fiMenuSchema = z
  .object({
    version: z.literal(1),
    products: z.array(productSchema).max(30),
    packages: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Name each menu option").max(40),
          product_ids: z.array(z.uuid()).max(30),
        }),
      )
      .length(4),
    selected: z
      .union([z.number().int().min(0).max(3), z.literal("declined")])
      .nullable(),
    customer_name: z.string().max(250).optional(),
    co_buyer_name: z.string().max(250).optional(),
  })
  .superRefine((menu, ctx) => {
    const ids = new Set(menu.products.map((p) => p.id));
    if (ids.size !== menu.products.length)
      ctx.addIssue({
        code: "custom",
        message: "Each menu product must have a unique ID",
      });
    for (const option of menu.packages) {
      if (
        new Set(option.product_ids).size !== option.product_ids.length ||
        option.product_ids.some((id) => !ids.has(id))
      )
        ctx.addIssue({
          code: "custom",
          message: "Check the products included in each menu option",
        });
      if (
        sum(
          menu.products
            .filter((p) => option.product_ids.includes(p.id))
            .map((p) => p.price),
        ) > 1000000
      )
        ctx.addIssue({
          code: "custom",
          message: "Combined product prices exceed the quote limit",
        });
    }
  });
export type FIMenu = z.infer<typeof fiMenuSchema>;
export type FIChoice = Exclude<FIMenu["selected"], null>;
export const fiProductName = (p: FIProduct) =>
  p.name?.trim() || productKinds[p.kind];
export const fiCoverage = (p: FIProduct) =>
  [
    p.term_months ? `${p.term_months} months` : "Term not specified",
    p.mileage_limit
      ? `${p.mileage_limit.toLocaleString("en-US")} ${p.protection_plan ? "additional miles" : "miles"}`
      : p.unlimited_miles
        ? "Unlimited miles"
        : "Mileage not specified",
    ...(p.protection_plan === "maintenance" && p.maintenance_visits
      ? [`${p.maintenance_visits} visits · $125 per visit`]
      : []),
  ].join(" / ");

export function newFIMenu(products: FIProduct[] = [], legacy = 0): FIMenu {
  const items = structuredClone(
    products.length || !legacy
      ? products
      : [
          {
            id: crypto.randomUUID(),
            kind: "service_contract" as const,
            provider: "",
            contract_number: "",
            term_months: 0,
            mileage_limit: 0,
            deductible: 0,
            cost: null,
            price: legacy,
            notes: "Carried forward from the existing service contract amount.",
          },
        ],
  );
  const counts = [
    items.length,
    Math.max(1, items.length - 1),
    Math.max(1, Math.ceil(items.length / 2)),
    1,
  ];
  return {
    version: 1,
    products: items,
    selected: null,
    packages: counts.map((n, i) => ({
      name: `Option ${"ABCD"[i]}`,
      product_ids: items.slice(0, n).map((p) => p.id),
    })),
  };
}
export function cloneFIMenu(menu: FIMenu): FIMenu {
  const ids = new Map(menu.products.map((p) => [p.id, crypto.randomUUID()]));
  return {
    version: 1,
    selected: null,
    products: menu.products.map((p) => ({
      ...p,
      id: ids.get(p.id)!,
      contract_number: "",
      notes: "",
    })),
    packages: menu.packages.map((p) => ({
      ...p,
      product_ids: p.product_ids.map((id) => ids.get(id)!),
    })),
  };
}
export function fiSelectedProducts(
  menu: FIMenu,
  choice: FIChoice,
): FIProduct[] {
  return choice === "declined"
    ? []
    : menu.products.filter((p) =>
        menu.packages[choice].product_ids.includes(p.id),
      );
}
export function fiOptionValues(
  base: FinanceValues,
  menu: FIMenu,
  choice: FIChoice,
): FinanceValues {
  const products = fiSelectedProducts(menu, choice);
  const values = {
    ...base,
    products,
    serviceContract: sum(products.map((p) => p.price)),
    fiMenu: { ...menu, selected: choice },
  };
  return { ...values, tax: calculateQuote(values).tax };
}
export function fiSelectionMatches(values: FinanceValues) {
  const menu = values.fiMenu;
  if (!menu || menu.selected === null) return false;
  const selected = fiSelectedProducts(menu, menu.selected);
  const actual = values.products ?? [];
  return (
    selected.length === actual.length &&
    selected.every(
      (p, i) =>
        JSON.stringify(productSchema.parse(p)) ===
        JSON.stringify(productSchema.parse(actual[i])),
    ) &&
    sum(selected.map((p) => p.price)) === (values.serviceContract ?? 0)
  );
}
export function clearFISelection(values: FinanceValues): FinanceValues {
  return values.fiMenu
    ? { ...values, fiMenu: { ...values.fiMenu, selected: null } }
    : values;
}
export function fiPresentationKey(values: FinanceValues) {
  const menu = values.fiMenu;
  return JSON.stringify({
    figures: [
      values.mode ?? "finance",
      values.price,
      values.docFee,
      values.addOns ?? 0,
      values.titleFee,
      values.otherTaxes ?? 0,
      values.tradeAllowance,
      values.payoff,
      values.downPayment,
      values.apr,
      values.months,
      values.daysToFirstPayment ?? 30,
      calculateQuote(values),
    ],
    products: (values.products ?? []).map(customerFIProduct),
    menu: menu && {
      selected: menu.selected,
      packages: menu.packages,
      products: menu.products.map(customerFIProduct),
    },
  });
}
// Customer documents use this allowlist; never spread a stored product into print data.
export function customerFIProduct(p: FIProduct) {
  return {
    id: p.id,
    ...(p.protection_plan ? { protection_plan: p.protection_plan } : {}),
    ...(p.claim_limit ? { claim_limit: p.claim_limit } : {}),
    name: fiProductName(p),
    provider: p.provider,
    description: p.description || "",
    coverage: fiCoverage(p),
    deductible: p.deductible,
    price: p.price,
  };
}

export function fiBillOfSale(values: FinanceValues) {
  const products = values.products;
  const kindTotal = (kind: FIProduct["kind"]) =>
    sum((products ?? []).filter((p) => p.kind === kind).map((p) => p.price));
  const other = (products ?? []).filter(
    (p) =>
      !["service_contract", "gap", "maintenance", "tire_wheel"].includes(
        p.kind,
      ),
  );
  const groups =
    other.length <= 2
      ? other.map((p) => ({ label: productKinds[p.kind], price: p.price }))
      : [
          { label: productKinds[other[0].kind], price: other[0].price },
          {
            label: "Additional protection products",
            price: sum(other.slice(1).map((p) => p.price)),
          },
        ];
  return {
    service_contract: products
      ? kindTotal("service_contract")
      : (values.serviceContract ?? 0),
    gap: kindTotal("gap"),
    prepaid_maintenance: kindTotal("maintenance"),
    tire_wheel: kindTotal("tire_wheel"),
    other_product_1_description: groups[0]?.label || "",
    other_product_1: groups[0]?.price ?? 0,
    other_product_2_description: groups[1]?.label || "",
    other_product_2: groups[1]?.price ?? 0,
    optional_products_total: productsTotal(values),
  };
}
