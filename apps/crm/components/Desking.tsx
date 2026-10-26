"use client";
import { useRef, useState } from "react";
import {
  Printer,
  Car,
  ArrowLeftRight,
  Save,
  Mail,
  MessageSquare,
  UserPlus,
  LayoutGrid,
  FileCheck2,
} from "lucide-react";
import {
  deskingDefaults,
  deskingDraft,
  selectedDeskingValues,
} from "../lib/desking";
import {
  type Customer,
  type Opportunity,
  type Quote,
  type QuoteValues,
  type Command,
  type QuickQuoteInput,
  type PrintableQuote,
  defaultQuote,
  quickQuoteSchema,
  quoteMath,
  dayKey,
  fullMoney,
  opportunityOpen,
} from "../lib/model";
import { financePayment } from "../lib/finance";
import { type InventoryVehicle, vehicleName } from "../lib/vehicles";
import { VehicleFacts } from "./VehicleFields";
import { FIProducts } from "./FIProducts";
import { productsTotal } from "../lib/operations";
import { FIMenu } from "./FIMenu";
import { FIMenuPrint } from "./FIMenuPrint";
import { PrintDocument } from "./PrintDocument";
import {
  clearFISelection,
  fiOptionValues,
  fiSelectionMatches,
  fiPresentationKey,
} from "../lib/fi-menu";
type DeskingProps = {
  inventory: InventoryVehicle[];
  busy: boolean;
  dealership?: string;
} & (
  | {
      quick?: undefined;
      customer: Customer;
      opportunity: Opportunity;
      quotes: Quote[];
      onSave: (
        c: Extract<Command, { type: "save_quote" }>,
      ) => Promise<{ ok: boolean }>;
      onPrint: (q: Quote) => void;
      onShare?: (q: Quote, channel: "email" | "sms") => void;
      onEdit: () => void;
    }
  | {
      quick: {
        onPrint: (q: QuickQuoteInput) => void;
        onCreate: (q: QuickQuoteInput) => void;
      };
      customer?: never;
      opportunity?: never;
      quotes?: never;
      onSave?: never;
      onPrint?: never;
      onShare?: never;
      onEdit?: never;
    }
);
export function Desking({
  customer,
  opportunity,
  inventory,
  quotes = [],
  busy,
  onSave,
  onPrint,
  onShare,
  onEdit,
  quick,
  dealership = "Drive Max Used Cars",
}: DeskingProps) {
  const [productsOpen, setProductsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPrint, setMenuPrint] = useState<{
    quote: PrintableQuote;
    acceptance: boolean;
  } | null>(null);
  const [quickInventory, setQuickInventory] = useState("");
  const [localError, setLocalError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const saved = quotes
      .filter((q) => q.opportunity_id === opportunity?.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    readOnly = opportunity ? !opportunityOpen(opportunity) : false,
    latest = readOnly
      ? (opportunity?.sale_snapshot?.quote ?? undefined)
      : saved.find(
          (q) =>
            (q.inventory_id ?? null) === opportunity?.inventory_id &&
            (!!opportunity?.inventory_id ||
              q.vehicle === opportunity?.vehicle_interest),
        );
  const vehicle = quick
    ? inventory.find((v) => v.id === quickInventory)
    : readOnly
      ? opportunity?.vehicle_details
      : (inventory.find((v) => v.id === opportunity?.inventory_id) ??
        opportunity?.vehicle_details);
  const [draft, setDraft] = useState<QuoteValues>(() =>
    deskingDraft(
      quick
        ? { ...defaultQuote }
        : deskingDefaults(customer!, readOnly ? [] : inventory, latest),
      !!latest,
    ),
  );
  const [description, setDescription] = useState(
    vehicle
      ? vehicleName(vehicle) || opportunity?.vehicle_interest || ""
      : opportunity?.vehicle_interest || "",
  );
  const terms = draft.financeOptions!,
    downs = draft.downPayments!,
    selectedRow = draft.selectedOption ?? 2,
    selectedCol = draft.selectedDown ?? 0;
  const values = selectedDeskingValues(draft);
  const totals = quoteMath(values);
  const currentQuote: PrintableQuote = {
    vehicle: description,
    values: { ...values, tax: totals.tax },
    created_at: new Date().toISOString(),
    vehicle_details: vehicle ?? null,
    snapshot_version: 1,
    trade_snapshot: customer?.trade ?? null,
  };
  const acceptanceCurrent =
    latest &&
    fiSelectionMatches(latest.values) &&
    fiPresentationKey(latest.values) === fiPresentationKey(currentQuote.values);
  function quickAction(action: "onPrint" | "onCreate") {
    if (!quick || !form.current?.reportValidity()) return;
    if (
      quickInventory &&
      !inventory.some((v) => v.id === quickInventory && v.status === "in_stock")
    ) {
      setLocalError(
        "That vehicle is no longer in stock. Select another vehicle or use a manual price.",
      );
      return;
    }
    const result = quickQuoteSchema.safeParse({
      inventory_id: quickInventory || null,
      vehicle: description,
      values: { ...values, tax: totals.tax },
    });
    if (!result.success) {
      setLocalError(
        result.error.issues[0]?.message || "Check the quote figures.",
      );
      return;
    }
    setLocalError("");
    quick[action](result.data);
  }
  const field = (
    key: keyof QuoteValues,
    label: string,
    max = 1000000,
    min = 0,
    step = 0.01,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={String(draft[key] ?? 0)}
        required
        readOnly={readOnly}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="profile-body desking">
      {productsOpen && (
        <FIProducts
          products={draft.products}
          legacy={draft.serviceContract ?? 0}
          readOnly={readOnly}
          temporary={!!quick}
          onClose={() => setProductsOpen(false)}
          onSave={(products) =>
            setDraft(
              clearFISelection({
                ...draft,
                products,
                serviceContract: productsTotal({ ...draft, products }),
              }),
            )
          }
        />
      )}
      {menuOpen && customer && (
        <FIMenu
          quote={readOnly && latest ? latest : currentQuote}
          customer={customer}
          dealership={dealership}
          quotes={quotes}
          busy={busy}
          readOnly={readOnly}
          onClose={() => setMenuOpen(false)}
          onSave={async (menu, choice) => {
            if (!onSave || !opportunity) return { ok: false };
            const next =
              choice === null
                ? {
                    ...currentQuote.values,
                    fiMenu: { ...menu, selected: null },
                  }
                : fiOptionValues(currentQuote.values, menu, choice);
            const result = await onSave({
              type: "save_quote",
              customer_id: customer.id,
              opportunity_id: opportunity.id,
              vehicle: description,
              values: next,
            });
            if (result.ok) setDraft(next);
            return result;
          }}
        />
      )}
      {menuPrint && (
        <PrintDocument
          landscape={!menuPrint.acceptance}
          onClose={() => setMenuPrint(null)}
        >
          <FIMenuPrint
            quote={menuPrint.quote}
            customer={customer ?? null}
            dealership={dealership}
            acceptance={menuPrint.acceptance}
          />
        </PrintDocument>
      )}
      <div className="desk-section-head">
        <div>
          <span className="eyebrow">
            {quick
              ? "NO CUSTOMER REQUIRED"
              : readOnly
                ? "COMPLETED OPPORTUNITY"
                : "WORK THE DEAL"}
          </span>
          <h3>{quick ? "Quick quote" : "Desking"}</h3>
        </div>
        {!readOnly && !quick && (
          <button className="btn small" onClick={onEdit}>
            Change vehicle / trade
          </button>
        )}
      </div>
      {quick && (
        <div className="quick-quote-vehicle">
          <label>
            Inventory vehicle (optional)
            <select
              aria-label="Quick quote inventory vehicle"
              value={quickInventory}
              onChange={(e) => {
                const selected = inventory.find((v) => v.id === e.target.value);
                setQuickInventory(e.target.value);
                setDescription(selected ? vehicleName(selected) : "");
                if (selected) setDraft({ ...draft, price: selected.price });
                setLocalError("");
              }}
            >
              <option value="">Manual price · no vehicle selected</option>
              {inventory
                .filter(
                  (v) => v.status === "in_stock" || v.id === quickInventory,
                )
                .map((v) => (
                  <option
                    key={v.id}
                    value={v.id}
                    disabled={v.status !== "in_stock"}
                  >
                    {v.stock_number} · {vehicleName(v)} · {fullMoney(v.price)}
                    {v.status === "in_stock" ? "" : " · unavailable"}
                  </option>
                ))}
            </select>
          </label>
          <p className="ops-help">
            Enter a price below, or select a vehicle to start with its asking
            price. Selecting a vehicle does not reserve it.
          </p>
        </div>
      )}
      {vehicle && (
        <div className="desk-stock">
          <div className="desk-stock-title">
            <Car size={19} />
            <div>
              <strong>
                {vehicleName(vehicle) || opportunity?.vehicle_interest}
              </strong>
              <span>
                {vehicle.vin || "Manual vehicle"} ·{" "}
                {readOnly
                  ? "Recorded at closing"
                  : quickInventory || opportunity?.inventory_id
                    ? "Linked inventory"
                    : "Manual vehicle"}
              </span>
            </div>
          </div>
          <VehicleFacts
            vehicle={vehicle}
            today={
              readOnly
                ? (opportunity!.sold_on ?? dayKey(opportunity!.closed_at!))
                : dayKey()
            }
            compact
          />
        </div>
      )}
      {readOnly && (
        <p className="history-notice">
          This opportunity is closed. Create a new opportunity for the next
          purchase. Saved proposals and paperwork remain available below.
        </p>
      )}
      <form
        ref={form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (quick || !customer || !opportunity || !onSave) return;
          await onSave({
            type: "save_quote",
            customer_id: customer.id,
            opportunity_id: opportunity.id,
            vehicle: description,
            values: { ...values, tax: totals.tax },
          });
        }}
      >
        <div className="deal-mode" role="group" aria-label="Purchase type">
          {(["cash", "finance"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={draft.mode === mode ? "selected" : ""}
              disabled={readOnly}
              onClick={() => setDraft({ ...draft, mode })}
            >
              {mode === "cash" ? "Cash purchase" : "Finance purchase"}
              <strong>
                {mode === "cash"
                  ? fullMoney(totals.total)
                  : fullMoney(totals.payment) + "/mo"}
              </strong>
            </button>
          ))}
        </div>
        <div className="desking-layout">
          <section className="desk-section">
            <div className="desk-section-head">
              <h3>Sale figures</h3>
              {!readOnly && vehicle?.price != null && (
                <button
                  className="text-btn"
                  type="button"
                  onClick={() => setDraft({ ...draft, price: vehicle.price! })}
                >
                  Use inventory price
                </button>
              )}
            </div>
            <label>
              Vehicle description{quick ? " (optional)" : ""}
              <input
                aria-label="Vehicle description"
                value={description}
                readOnly={!quick || !!quickInventory}
                required={!quick}
                maxLength={250}
                placeholder={
                  quick ? "Leave blank for a price-only estimate" : undefined
                }
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="form-grid">
              {field("price", "Selling price")}
              {field("docFee", "Document fee")}
              {field("addOns", "Accessories / taxable add-ons")}
              <div className="ops-product-summary">
                <small>F&I products</small>
                <strong>{fullMoney(productsTotal(draft))}</strong>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setProductsOpen(true)}
                >
                  {readOnly ? "View products" : "Edit product details"}
                </button>
                {!quick && (!readOnly || draft.fiMenu) && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      if (readOnly || form.current?.reportValidity())
                        setMenuOpen(true);
                    }}
                  >
                    <LayoutGrid size={14} />
                    {readOnly
                      ? "View F&I menu"
                      : draft.fiMenu
                        ? "Open F&I menu"
                        : "Build F&I menu"}
                  </button>
                )}
              </div>
              {field("titleFee", "Title / registration fees")}
              {field("otherTaxes", "Other verified taxes")}
            </div>
            {!quick && draft.fiMenu && (
              <div className="fi-desking-selection">
                <strong>
                  {draft.fiMenu.selected === "declined"
                    ? "All optional products declined"
                    : draft.fiMenu.selected !== null
                      ? `${draft.fiMenu.packages[draft.fiMenu.selected].name} selected`
                      : "F&I menu saved · selection pending"}
                </strong>
                {acceptanceCurrent && latest ? (
                  <button
                    className="btn small"
                    type="button"
                    onClick={() =>
                      setMenuPrint({ quote: latest, acceptance: true })
                    }
                  >
                    <FileCheck2 size={14} />
                    Print final acceptance
                  </button>
                ) : (
                  draft.fiMenu.selected !== null && (
                    <small>
                      Save the current deal figures before printing final
                      acceptance.
                    </small>
                  )
                )}
              </div>
            )}
            <div className="tax-summary">
              <div>
                <span>NC highway-use tax · 3%</span>
                <strong>{fullMoney(totals.tax)}</strong>
              </div>
              <small>
                {fullMoney(totals.taxBase)} taxable base after trade allowance.
                Payoff does not reduce tax.
              </small>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.taxMode === "manual"}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    taxMode: e.target.checked ? "manual" : "auto",
                    tax: totals.tax,
                  })
                }
              />
              Override highway-use tax
            </label>
            {draft.taxMode === "manual" && (
              <div className="form-grid">
                {field("tax", "Verified highway-use tax")}
                <label>
                  Override reason
                  <input
                    required
                    value={draft.taxReason ?? ""}
                    maxLength={500}
                    readOnly={readOnly}
                    onChange={(e) =>
                      setDraft({ ...draft, taxReason: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
            <p className="fine-print">
              Automatic calculation is for a standard NC retail vehicle sale.
              Separately stated service contracts are excluded from highway-use
              tax; enter any applicable other taxes separately.
            </p>
            <h3 className="desk-trade-heading">
              <ArrowLeftRight size={17} />
              Trade-in
            </h3>
            <p className="fine-print">
              {quick
                ? "Enter trade figures if needed. Trade vehicle details are optional for this estimate."
                : customer?.trade?.description ||
                  customer?.trade_vehicle ||
                  "No trade-in"}
              {customer?.trade &&
                ` · ${customer.trade.vin} · ${customer.trade.mileage.toLocaleString()} miles`}
            </p>
            <div className="form-grid">
              {field("tradeAllowance", "Trade allowance")}
              {field("payoff", "Trade payoff")}
              {field("acv", "ACV · internal")}
              {field("recon", "Trade recon · internal")}
            </div>
          </section>
          <section className="desk-payment">
            <span className="eyebrow">PAYMENT OPTIONS</span>
            <h3>
              {draft.mode === "cash"
                ? "Cash purchase summary"
                : "Compare terms and down payments"}
            </h3>
            {draft.mode === "finance" ? (
              <>
                <div className="form-grid">
                  {field(
                    "daysToFirstPayment",
                    "Days to first payment",
                    365,
                    30,
                    1,
                  )}
                  <div className="first-payment-note">
                    <strong>{values.daysToFirstPayment} days</strong>
                    <small>Until the first scheduled payment.</small>
                  </div>
                </div>
                <div className="payment-table-scroll">
                  <table className="payment-matrix">
                    <thead>
                      <tr>
                        <th>Term / APR</th>
                        {downs.map((d, i) => (
                          <th key={i}>
                            <label>
                              Down payment {i + 1}
                              <input
                                aria-label={`Down payment option ${i + 1}`}
                                type="number"
                                min={0}
                                max={1000000}
                                step=".01"
                                value={d}
                                readOnly={readOnly}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    downPayments: downs.map((x, j) =>
                                      i === j ? Number(e.target.value) : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t, i) => (
                        <tr key={i}>
                          <th>
                            <label>
                              Months
                              <input
                                aria-label={`Term ${i + 1} months`}
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={t.months}
                                readOnly={readOnly}
                                required
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    financeOptions: terms.map((x, j) =>
                                      i === j
                                        ? {
                                            ...x,
                                            months: Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label>
                              APR %
                              <input
                                aria-label={`Term ${i + 1} APR`}
                                type="number"
                                min={0}
                                max={50}
                                step=".01"
                                value={t.apr}
                                readOnly={readOnly}
                                required
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    financeOptions: terms.map((x, j) =>
                                      i === j
                                        ? { ...x, apr: Number(e.target.value) }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </th>
                          {downs.map((down, j) => {
                            const p = financePayment(
                              totals.total - down,
                              t.apr,
                              t.months,
                              draft.daysToFirstPayment,
                            );
                            return (
                              <td key={j}>
                                <button
                                  type="button"
                                  aria-label={`${t.months} months at ${t.apr}% with ${fullMoney(down)} down: ${fullMoney(p.payment)} monthly`}
                                  aria-pressed={
                                    i === selectedRow && j === selectedCol
                                  }
                                  className={
                                    i === selectedRow && j === selectedCol
                                      ? "selected"
                                      : ""
                                  }
                                  disabled={readOnly}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      selectedOption: i,
                                      selectedDown: j,
                                    })
                                  }
                                >
                                  <strong>{fullMoney(p.payment)}</strong>
                                  <small>per month</small>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="selected-payment">
                  <span>Selected estimate</span>
                  <strong>
                    {fullMoney(totals.payment)}
                    <small>/ month</small>
                  </strong>
                  <p>
                    {values.months} months · {values.apr}% APR ·{" "}
                    {fullMoney(values.downPayment)} down
                  </p>
                  <dl>
                    <dt>Balance to finance</dt>
                    <dd>{fullMoney(totals.balance)}</dd>
                  </dl>
                </div>
                <p className="fine-print">
                  Estimated payment only. Actual lender calculations, approval,
                  and final contract terms may differ.
                </p>
              </>
            ) : (
              <>
                {field("downPayment", "Deposit / amount already paid")}
                <div className="selected-payment">
                  <span>Remaining cash balance</span>
                  <strong>{fullMoney(totals.balance)}</strong>
                  <p>Total after trade and payoff: {fullMoney(totals.total)}</p>
                </div>
              </>
            )}
            <fieldset className="quote-presentation" disabled={readOnly}>
              <legend>Customer quote display</legend>
              <label>
                <input
                  type="checkbox"
                  checked={draft.showAPR !== false}
                  onChange={(e) =>
                    setDraft({ ...draft, showAPR: e.target.checked })
                  }
                />{" "}
                Show APR on customer quotes
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.showProtectionProducts !== false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      showProtectionProducts: e.target.checked,
                    })
                  }
                />{" "}
                Show protection products in quote itemization
              </label>
              <p>
                Totals and payments include all selected products. Final sales
                paperwork keeps its product details.
              </p>
            </fieldset>
            {quick ? (
              <div className="quick-quote-actions">
                {localError && (
                  <p className="form-error" role="alert">
                    {localError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => quickAction("onPrint")}
                >
                  <Printer size={16} />
                  Print quick quote
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => quickAction("onCreate")}
                >
                  <UserPlus size={16} />
                  Create customer & save quote
                </button>
                <p className="ops-help">
                  Temporary calculation. Print it, or create a customer to keep
                  the quote. Closing this screen clears the figures.
                </p>
              </div>
            ) : (
              !readOnly && (
                <button className="btn primary desk-save" disabled={busy}>
                  <Save size={16} />
                  Save desking version
                </button>
              )
            )}
          </section>
        </div>
      </form>
      {!quick && (
        <>
          <div className="section-heading">
            <div>
              <h2>Saved proposals</h2>
              <p>Each version keeps its own vehicle, trade, and figures.</p>
            </div>
          </div>
          {saved.map((q) => (
            <div className="saved-quote" key={q.id}>
              <div>
                <strong>{q.vehicle}</strong>
                <span>
                  {new Date(q.created_at).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}{" "}
                  · {fullMoney(quoteMath(q.values).balance)} balance
                </span>
              </div>
              {onShare && (
                <div className="ops-actions">
                  <button
                    className="btn small"
                    onClick={() => onShare(q, "email")}
                  >
                    <Mail size={14} />
                    Email quote
                  </button>
                  <button
                    className="btn small"
                    onClick={() => onShare(q, "sms")}
                  >
                    <MessageSquare size={14} />
                    Text quote
                  </button>
                </div>
              )}
              <button className="btn small" onClick={() => onPrint?.(q)}>
                <Printer size={14} />
                Print quote
              </button>
              {q.values.fiMenu && (
                <div className="ops-actions">
                  <button
                    className="btn small"
                    onClick={() =>
                      setMenuPrint({ quote: q, acceptance: false })
                    }
                  >
                    Print F&I menu
                  </button>
                  {fiSelectionMatches(q.values) && (
                    <button
                      className="btn small"
                      onClick={() =>
                        setMenuPrint({ quote: q, acceptance: true })
                      }
                    >
                      Print saved acceptance
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
