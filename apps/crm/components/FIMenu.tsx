"use client";
import { useState, type ReactNode } from "react";
import { Printer, SlidersHorizontal, Check, Save } from "lucide-react";
import {
  type Customer,
  type PrintableQuote,
  type Quote,
  fullMoney,
  quoteMath,
} from "../lib/model";
import {
  fiMenuSchema,
  fiOptionValues,
  fiProductName,
  newFIMenu,
  cloneFIMenu,
  fiPresentationKey,
  type FIMenu as Menu,
  type FIChoice,
} from "../lib/fi-menu";
import { productsTotal } from "../lib/operations";
import { FIProducts } from "./FIProducts";
import { FIMenuPrint } from "./FIMenuPrint";
import { PrintDocument } from "./PrintDocument";
import { Modal } from "./ui";

export function FIMenu({
  quote,
  customer,
  dealership,
  quotes,
  busy,
  readOnly,
  onClose,
  onSave,
  contracting,
}: {
  quote: PrintableQuote;
  customer: Customer;
  dealership: string;
  quotes: Quote[];
  busy: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (menu: Menu, choice: FIChoice | null) => Promise<{ ok: boolean }>;
  contracting?: ReactNode;
}) {
  const [menu, setMenu] = useState<Menu>(() =>
    structuredClone(
      quote.values.fiMenu ??
        newFIMenu(quote.values.products, quote.values.serviceContract),
    ),
  );
  const [editing, setEditing] = useState(false),
    [printing, setPrinting] = useState(false),
    [error, setError] = useState("");
  const finance = quote.values.mode !== "cash",
    base = quoteMath(fiOptionValues(quote.values, menu, "declined"));
  const prior = quotes
    .filter((q) => q.values.fiMenu)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30);
  function checkedMenu() {
    if (!readOnly && menu.products.some((p) => !p.protection_plan)) {
      setError(
        "Only Drive Max Protection products are available. Open Edit menu products to replace or remove previously saved products before applying this menu.",
      );
      return null;
    }
    const parsed = fiMenuSchema.safeParse(menu);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ||
          "Check the menu products and options.",
      );
      return null;
    }
    if (!parsed.data.products.length) {
      setError(
        "Add the products you want to offer before printing or applying this menu.",
      );
      return null;
    }
    setError("");
    return parsed.data;
  }
  async function save(choice: FIChoice | null) {
    const checked = checkedMenu();
    if (!checked) return;
    const result = await onSave(checked, choice);
    if (result.ok) onClose();
    else
      setError(
        "The menu could not be saved. Your changes are still here; check the workspace message and try again.",
      );
  }
  return (
    <Modal
      title={readOnly ? "Saved F&I menu" : "Build an F&I menu"}
      subtitle="Four options. One set of vehicle and financing figures. Customer printouts exclude provider costs and internal notes."
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="fi-menu-builder">
        {fiPresentationKey({ ...quote.values, fiMenu: menu }) ===
          fiPresentationKey(quote.values) && contracting}
        <div className="fi-builder-toolbar">
          <div>
            <span className="eyebrow">WITHOUT OPTIONAL PRODUCTS</span>
            <strong>
              {fullMoney(finance ? base.payment : base.balance)}
              {finance ? " / month" : " cash due"}
            </strong>
            <small>
              {finance
                ? `${quote.values.months} months · ${quote.values.apr}% APR · ${fullMoney(quote.values.downPayment)} down`
                : `Vehicle total ${fullMoney(base.total)} · ${fullMoney(quote.values.downPayment)} paid`}
            </small>
          </div>
          <div className="ops-actions">
            <button
              className="btn"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
              <SlidersHorizontal size={15} />
              {readOnly ? "View menu products" : "Edit menu products"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (checkedMenu()) setPrinting(true);
              }}
            >
              <Printer size={15} />
              Preview customer menu
            </button>
          </div>
        </div>
        {!readOnly && prior.length > 0 && (
          <label className="fi-copy-menu">
            Copy products and options from a saved menu
            <select
              aria-label="Copy saved F&I menu"
              value=""
              onChange={(e) => {
                const q = prior.find((q) => q.id === e.target.value);
                if (q?.values.fiMenu) {
                  setMenu(cloneFIMenu(q.values.fiMenu));
                  setError("");
                }
              }}
            >
              <option value="">Choose a previous menu (optional)</option>
              {prior.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.vehicle} ·{" "}
                  {new Date(q.created_at).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}
                </option>
              ))}
            </select>
            <small>
              Review coverage and prices for this vehicle. Contract numbers and
              internal notes are cleared when copied.
            </small>
          </label>
        )}
        {!menu.products.length && (
          <div className="fi-menu-empty">
            <h3>Start with the products you offer</h3>
            <p>
              Choose Drive Max Protection coverage, cost and selling price. Then
              include each product in the options below.
            </p>
            <button className="btn primary" onClick={() => setEditing(true)}>
              Add menu products
            </button>
          </div>
        )}
        <div className="fi-package-grid">
          {menu.packages.map((option, index) => {
            const optionValues = fiOptionValues(quote.values, menu, index),
              math = quoteMath(optionValues),
              products = optionValues.products!;
            const costKnown = products.every((p) => p.cost !== null),
              cost = products.reduce((sum, p) => sum + (p.cost ?? 0), 0),
              retail = productsTotal(optionValues);
            return (
              <section
                key={index}
                className={`fi-package ${menu.selected === index ? "fi-package-selected" : ""}`}
              >
                <div className="fi-package-heading">
                  <span>OPTION {"ABCD"[index]}</span>
                  <input
                    aria-label={`Option ${"ABCD"[index]} name`}
                    value={option.name}
                    maxLength={40}
                    readOnly={readOnly || busy}
                    onChange={(e) =>
                      setMenu({
                        ...menu,
                        selected: null,
                        packages: menu.packages.map((p, i) =>
                          i === index ? { ...p, name: e.target.value } : p,
                        ),
                      })
                    }
                  />
                </div>
                <div className="fi-package-price">
                  <strong>
                    {fullMoney(finance ? math.payment : math.balance)}
                  </strong>
                  <span>
                    {finance
                      ? "per month with coverage"
                      : "remaining cash balance"}
                  </span>
                  <small>
                    +
                    {fullMoney(
                      finance
                        ? math.payment - base.payment
                        : math.balance - base.balance,
                    )}
                    {finance ? "/mo" : ""} vs. no products
                  </small>
                </div>
                <div className="fi-package-products">
                  {menu.products.map((product) => (
                    <label key={product.id}>
                      <input
                        type="checkbox"
                        aria-label={`${option.name}: ${fiProductName(product)}`}
                        checked={option.product_ids.includes(product.id)}
                        disabled={readOnly || busy || !product.protection_plan}
                        onChange={(e) =>
                          setMenu({
                            ...menu,
                            selected: null,
                            packages: menu.packages.map((p, i) =>
                              i === index
                                ? {
                                    ...p,
                                    product_ids: e.target.checked
                                      ? [...p.product_ids, product.id]
                                      : p.product_ids.filter(
                                          (id) => id !== product.id,
                                        ),
                                  }
                                : p,
                            ),
                          })
                        }
                      />
                      <span>
                        {fiProductName(product)}
                        <small>{fullMoney(product.price)}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <dl className="fi-package-totals">
                  <dt>Product price</dt>
                  <dd>{fullMoney(retail)}</dd>
                  <dt>Vehicle total</dt>
                  <dd>{fullMoney(math.total)}</dd>
                  <dt>Cost · internal</dt>
                  <dd>{costKnown ? fullMoney(cost) : "Cost needed"}</dd>
                  <dt>Gross · internal</dt>
                  <dd>
                    {costKnown ? fullMoney(retail - cost) : "Cost needed"}
                  </dd>
                </dl>
                {!readOnly && (
                  <button
                    className="btn primary"
                    disabled={busy || !menu.products.length}
                    onClick={() => save(index)}
                  >
                    <Check size={14} />
                    Apply {option.name || `option ${"ABCD"[index]}`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          <div className="fi-menu-footer">
            <div>
              <p>
                Applying an option saves a new Desking version and updates the
                bill-of-sale amounts. Print the final acceptance from Desking
                for the customer’s signature.
              </p>
              <small>
                Save menu keeps the offered options and leaves the current deal
                products unchanged.
              </small>
            </div>
            <div className="ops-actions">
              <button
                className="btn"
                disabled={busy || !menu.products.length}
                onClick={() => save(null)}
              >
                <Save size={15} />
                Save menu
              </button>
              <button
                className="btn"
                disabled={busy || !menu.products.length}
                onClick={() => save("declined")}
              >
                Decline all & apply
              </button>
            </div>
          </div>
        )}
      </div>
      {editing && (
        <FIProducts
          menuCatalog
          products={menu.products}
          legacy={0}
          readOnly={readOnly}
          onClose={() => setEditing(false)}
          onSave={(products) => {
            const first = menu.products.length === 0;
            setMenu(
              first
                ? newFIMenu(products)
                : {
                    ...menu,
                    products,
                    selected: null,
                    packages: menu.packages.map((p) => ({
                      ...p,
                      product_ids: p.product_ids.filter((id) =>
                        products.some((x) => x.id === id),
                      ),
                    })),
                  },
            );
          }}
        />
      )}
      {printing && (
        <PrintDocument landscape onClose={() => setPrinting(false)}>
          <FIMenuPrint
            quote={{ ...quote, values: { ...quote.values, fiMenu: menu } }}
            customer={customer}
            dealership={dealership}
          />
        </PrintDocument>
      )}
    </Modal>
  );
}
