"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  type FIProduct,
  productKinds,
  productSchema,
  sum,
} from "../lib/operations";
import { fullMoney } from "../lib/model";
import { Modal } from "./ui";
export function FIProducts({
  products,
  legacy,
  onSave,
  onClose,
  readOnly = false,
  temporary = false,
}: {
  products?: FIProduct[];
  legacy: number;
  onSave: (p: FIProduct[]) => void;
  onClose: () => void;
  readOnly?: boolean;
  temporary?: boolean;
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
    [error, setError] = useState("");
  const update = (id: string, p: Partial<FIProduct>) =>
    setItems(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
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
      title="F&I products"
      subtitle="Retail prices flow into the quote. Provider costs remain internal."
      wide
      onClose={onClose}
    >
      <form
        className="modal-form ops-products"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const parsed = items.map((p) => productSchema.parse(p));
            if (sum(parsed.map((p) => p.price)) > 1000000)
              throw Error("Combined product prices exceed the quote limit");
            onSave(parsed);
            onClose();
          } catch {
            setError("Review product details and amounts before applying.");
          }
        }}
      >
        {items.map((p) => (
          <section className="ops-product" key={p.id}>
            <div className="ops-product-head">
              <label>
                Product
                <select
                  value={p.kind}
                  disabled={readOnly}
                  onChange={(e) =>
                    update(p.id, { kind: e.target.value as FIProduct["kind"] })
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
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${productKinds[p.kind]}`}
                  onClick={() => setItems(items.filter((x) => x.id !== p.id))}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <div className="ops-form-grid">
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
                  disabled={readOnly}
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
                  min="0"
                  max="240"
                  disabled={readOnly}
                  value={p.term_months}
                  onChange={(e) =>
                    update(p.id, { term_months: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Coverage mileage limit
                <input
                  type="number"
                  min="0"
                  max="3000000"
                  disabled={readOnly}
                  value={p.mileage_limit}
                  onChange={(e) =>
                    update(p.id, { mileage_limit: Number(e.target.value) })
                  }
                />
              </label>
              {money(p, "deductible", "Deductible")}
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
              Coverage notes
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
        {!readOnly && <button className="btn primary">Apply to quote</button>}
        <p className="ops-help">
          {temporary
            ? "Create a customer from Quick quote to retain these changes."
            : "Save the proposal in Desking to retain these changes."}{" "}
          A zero term or mileage means not specified; use notes for unlimited
          coverage.
        </p>
      </form>
    </Modal>
  );
}
