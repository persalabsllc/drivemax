"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import {
  type FIProduct,
  productKinds,
  productSchema,
  sum,
} from "../lib/operations";
import { fullMoney } from "../lib/model";
import {
  protectionDeductibles,
  protectionPlans,
  protectionIssuer,
} from "../lib/protection";
import { Modal } from "./ui";
export function FIProducts({
  products,
  legacy,
  onSave,
  onClose,
  readOnly = false,
  temporary = false,
  menuCatalog = false,
}: {
  products?: FIProduct[];
  legacy: number;
  onSave: (p: FIProduct[]) => void;
  onClose: () => void;
  readOnly?: boolean;
  temporary?: boolean;
  menuCatalog?: boolean;
}) {
  const [items, setItems] = useState<FIProduct[]>(
      () =>
        products ??
        (legacy
          ? [
              {
                id: crypto.randomUUID(),
                kind: "service_contract",
                provider: "",
                contract_number: "",
                term_months: 0,
                mileage_limit: 0,
                deductible: 0,
                cost: null,
                price: legacy,
                notes:
                  "Carried forward from service contract amount; verify provider cost.",
              },
            ]
          : []),
    ),
    [error, setError] = useState(""),
    [movedId, setMovedId] = useState<string | null>(null);
  const update = (id: string, p: Partial<FIProduct>) =>
    setItems((current) =>
      current.map((x) => (x.id === id ? { ...x, ...p } : x)),
    );
  const movedIndex = items.findIndex((p) => p.id === movedId);
  const productName = (p: FIProduct) => p.name?.trim() || productKinds[p.kind];
  function moveProduct(
    id: string,
    direction: -1 | 1,
    button: HTMLButtonElement,
  ) {
    if (readOnly) return;
    setItems((current) => {
      const from = current.findIndex((p) => p.id === id),
        to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setMovedId(id);
    // Keep the same product's controls in view after moving its long form.
    requestAnimationFrame(() => {
      const header = button.closest<HTMLElement>(".ops-product-head");
      if (!header?.isConnected) return;
      const nextButton = button.disabled
        ? header.querySelector<HTMLButtonElement>(
            "[data-reorder]:not(:disabled)",
          )
        : button;
      nextButton?.focus({ preventScroll: true });
      header.scrollIntoView({ block: "nearest" });
    });
  }
  const money = (
    p: FIProduct,
    k: "price" | "cost" | "deductible",
    label: string,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        required={k !== "cost"}
        disabled={readOnly}
        value={p[k] ?? ""}
        placeholder={k === "cost" ? "Cost unknown" : ""}
        onChange={(e) =>
          update(p.id, {
            [k]:
              e.target.value === "" && k === "cost"
                ? null
                : Number(e.target.value),
          })
        }
      />
    </label>
  );
  return (
    <Modal
      title={menuCatalog ? "Menu products" : "F&I products"}
      subtitle={
        menuCatalog
          ? "Set coverage, provider cost and customer price, then choose which options include each product."
          : "Retail prices flow into the quote. Provider costs remain internal."
      }
      wide
      onClose={onClose}
    >
      <form
        className="modal-form ops-products"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const parsed = items.map((p) => productSchema.parse(p));
            if (parsed.length > 30) throw Error("Up to 30 products per menu");
            if (sum(parsed.map((p) => p.price)) > 1000000)
              throw Error("Combined product prices exceed the quote limit");
            onSave(parsed);
            onClose();
          } catch {
            setError("Review product details and amounts before applying.");
          }
        }}
      >
        {!readOnly && items.length > 1 && (
          <p
            className="ops-help ops-product-order-status"
            role="status"
            aria-live="polite"
          >
            {movedIndex >= 0
              ? `${productName(items[movedIndex])} moved to position ${movedIndex + 1} of ${items.length}.`
              : "Use the up and down arrows to change the product order."}
          </p>
        )}
        {items.map((p, index) => (
          <section className="ops-product" key={p.id}>
            <div className="ops-product-head">
              <label>
                Product
                <select
                  value={p.kind}
                  disabled={readOnly}
                  onChange={(e) =>
                    update(p.id, {
                      kind: e.target.value as FIProduct["kind"],
                      protection_plan: undefined,
                    })
                  }
                >
                  {Object.entries(productKinds).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {!readOnly && (
                <div className="ops-product-actions">
                  <span
                    className="ops-product-position"
                    aria-label={`Position ${index + 1} of ${items.length}`}
                  >
                    {index + 1} / {items.length}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    data-reorder="up"
                    aria-label={`Move ${productName(p)} up`}
                    title="Move product up"
                    disabled={index === 0}
                    onClick={(e) => moveProduct(p.id, -1, e.currentTarget)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    data-reorder="down"
                    aria-label={`Move ${productName(p)} down`}
                    title="Move product down"
                    disabled={index === items.length - 1}
                    onClick={(e) => moveProduct(p.id, 1, e.currentTarget)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${productKinds[p.kind]}`}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((x) => x.id !== p.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className="ops-form-grid">
              {p.kind === "service_contract" && (
                <label>
                  Contract program
                  <select
                    disabled={readOnly}
                    value={p.protection_plan ?? ""}
                    onChange={(e) => {
                      const plan = e.target
                        .value as FIProduct["protection_plan"];
                      update(p.id, {
                        protection_plan: plan || undefined,
                        ...(plan
                          ? {
                              provider: protectionIssuer.name,
                              name: `Drive Max Protection ${protectionPlans[plan]}`,
                              contract_number: "",
                              deductible: protectionDeductibles.includes(
                                p.deductible as 0,
                              )
                                ? p.deductible
                                : 0,
                              description:
                                plan === "deluxe"
                                  ? "Listed engine, transmission and drive axle powertrain components. See contract for terms and exclusions."
                                  : "Listed powertrain components plus alternator, water pump, thermostat, listed sensors and engine accessories. See contract for terms and exclusions.",
                            }
                          : {}),
                      });
                    }}
                  >
                    <option value="">Other / outside provider</option>
                    <option value="deluxe">
                      Drive Max Protection · Deluxe
                    </option>
                    <option value="platinum">
                      Drive Max Protection · Platinum
                    </option>
                  </select>
                </label>
              )}
              <label>
                Product name (customer-facing)
                <input
                  disabled={readOnly}
                  value={p.name ?? ""}
                  placeholder={productKinds[p.kind]}
                  maxLength={80}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                />
              </label>
              <label>
                Provider
                <input
                  disabled={readOnly}
                  value={p.provider}
                  maxLength={250}
                  onChange={(e) => update(p.id, { provider: e.target.value })}
                />
              </label>
              <label>
                Contract number
                <input
                  disabled={readOnly || !!p.protection_plan}
                  placeholder={p.protection_plan ? "Assigned when issued" : ""}
                  value={p.contract_number}
                  maxLength={250}
                  onChange={(e) =>
                    update(p.id, { contract_number: e.target.value })
                  }
                />
              </label>
              <label>
                Term (months)
                <input
                  type="number"
                  min={p.protection_plan ? 1 : 0}
                  max={p.protection_plan ? 120 : 240}
                  disabled={readOnly}
                  value={p.term_months}
                  onChange={(e) =>
                    update(p.id, { term_months: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {p.protection_plan
                  ? "Additional covered miles"
                  : "Coverage mileage limit"}
                <input
                  type="number"
                  min={p.protection_plan ? 1 : 0}
                  max="3000000"
                  disabled={readOnly}
                  value={p.mileage_limit}
                  onChange={(e) =>
                    update(p.id, { mileage_limit: Number(e.target.value) })
                  }
                />
              </label>
              {p.protection_plan ? (
                <label>
                  Deductible
                  <select
                    disabled={readOnly}
                    value={p.deductible}
                    onChange={(e) =>
                      update(p.id, { deductible: Number(e.target.value) })
                    }
                  >
                    {protectionDeductibles.map((d) => (
                      <option key={d} value={d}>
                        {fullMoney(d)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                money(p, "deductible", "Deductible")
              )}
              {money(p, "cost", "Provider cost")}
              {money(p, "price", "Customer price")}
              <div className="ops-product-profit">
                <small>Product gross</small>
                <strong>
                  {p.cost === null
                    ? "Cost needed"
                    : fullMoney(p.price - p.cost)}
                </strong>
              </div>
            </div>
            <label>
              Coverage description (customer-facing)
              <textarea
                disabled={readOnly}
                value={p.description ?? ""}
                maxLength={400}
                placeholder="Describe the actual coverage shown in the provider’s contract."
                onChange={(e) => update(p.id, { description: e.target.value })}
              />
            </label>
            <label>
              Internal notes · not printed
              <input
                disabled={readOnly}
                value={p.notes}
                maxLength={2000}
                onChange={(e) => update(p.id, { notes: e.target.value })}
              />
            </label>
          </section>
        ))}
        {!items.length && (
          <p className="ops-help">No protection products on this quote.</p>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              setItems([
                ...items,
                {
                  id: crypto.randomUUID(),
                  kind: "service_contract",
                  provider: "",
                  contract_number: "",
                  term_months: 0,
                  mileage_limit: 0,
                  deductible: 0,
                  cost: null,
                  price: 0,
                  notes: "",
                },
              ])
            }
          >
            <Plus size={15} />
            Add product
          </button>
        )}
        <div className="ops-totals">
          <span>
            Customer total{" "}
            <strong>{fullMoney(sum(items.map((p) => p.price)))}</strong>
          </span>
          <span>
            Product gross{" "}
            <strong>
              {items.some((p) => p.cost === null)
                ? "Cost needed"
                : fullMoney(sum(items.map((p) => p.price - p.cost!)))}
            </strong>
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          <button className="btn primary">
            {menuCatalog ? "Update menu products" : "Apply to quote"}
          </button>
        )}
        <p className="ops-help">
          {menuCatalog
            ? "These products stay in the menu until you apply an option to the deal."
            : temporary
              ? "Create a customer from Quick quote to retain these changes."
              : "Save the proposal in Desking to retain these changes."}{" "}
          Drive Max Protection requires both months and additional covered
          miles. For outside products, a zero term or mileage means not
          specified.
        </p>
      </form>
    </Modal>
  );
}
