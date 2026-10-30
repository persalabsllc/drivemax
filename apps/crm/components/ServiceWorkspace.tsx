"use client";
import { useState } from "react";
import {
  Plus,
  Wrench,
  Printer,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Download,
  Save,
} from "lucide-react";
import {
  canManage,
  dayKey,
  fullMoney,
  type Command,
  type Workspace,
} from "../lib/model";
import {
  serviceBlank,
  serviceKinds,
  serviceStatuses,
  serviceTotals,
  servicePaid,
  serviceLabel,
  serviceOpen,
  serviceLimitBasis,
  serviceOrderSchema,
  type ServiceInput,
  type ServiceOrder,
  type ServiceLine,
  type ServiceAuthorization,
} from "../lib/service";
import { csvText } from "../lib/operations";
import { vehicleName } from "../lib/vehicles";
import { Modal, Empty, SectionTitle } from "./ui";
import { PrintDocument } from "./PrintDocument";
export type ManagementRun = (
  p: Command,
  message?: string,
) => Promise<{ ok: boolean; id?: string; error?: string }>;
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
export function ServiceWorkspace({
  ws,
  run,
  busy,
  customerId,
  opportunityId,
  initialOrderId,
  onCustomer,
}: {
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  customerId?: string;
  opportunityId?: string;
  initialOrderId?: string;
  onCustomer?: (id: string, opportunity?: string) => void;
}) {
  const [selected, setSelected] = useState(initialOrderId ?? ""),
    [editor, setEditor] = useState<ServiceOrder | ServiceInput | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("open"),
    [kind, setKind] = useState("all"),
    [staff, setStaff] = useState("");
  if (!canManage(ws.member.role)) return null;
  const today = dayKey(),
    orders = (ws.service_orders ?? []).filter(
      (o) => !customerId || o.customer_id === customerId,
    ),
    open = orders.filter(serviceOpen),
    overdue = open.filter((o) => o.due_on && o.due_on < today);
  const rows = orders
    .filter(
      (o) =>
        (!query ||
          [
            o.customer_name,
            o.vehicle,
            o.vin,
            o.stock_number,
            o.vendor,
            o.concern,
            serviceLabel(o),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (kind === "all" || o.kind === kind) &&
        (!staff || o.assigned_to === staff) &&
        (filter === "all" ||
          (filter === "open" && serviceOpen(o)) ||
          (filter === "overdue" &&
            !!o.due_on &&
            o.due_on < today &&
            serviceOpen(o)) ||
          (filter === "completed" && o.status === "completed") ||
          (filter === "unpaid" &&
            o.kind === "customer_pay" &&
            o.status === "completed" &&
            serviceTotals(o).total > servicePaid(ws, o.id))),
    )
    .sort(
      (a, b) =>
        (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") ||
        b.created_at.localeCompare(a.created_at),
    );
  const order = orders.find((o) => o.id === selected);
  return (
    <section className="management-page service-workspace">
      {order ? (
        <ServiceDetail
          key={order.id}
          order={order}
          ws={ws}
          run={run}
          busy={busy}
          onBack={() => setSelected("")}
          onEdit={() => setEditor(order)}
          onCustomer={onCustomer}
        />
      ) : (
        <>
          <SectionTitle
            title={
              customerId ? "Service history & promises" : "Service & We Owe"
            }
            subtitle="Every repair, customer promise, and vehicle handoff in one place."
            action={
              <button
                className="btn primary"
                onClick={() =>
                  setEditor(serviceBlank(ws, customerId, opportunityId))
                }
              >
                <Plus size={16} />
                New repair order
              </button>
            }
          />
          <div className="management-cards service-cards">
            <button
              onClick={() => {
                setFilter("open");
                setKind("all");
              }}
            >
              <Wrench size={18} />
              <span>Open work</span>
              <strong>{open.length}</strong>
              <small>Repairs and promises in progress</small>
            </button>
            <button
              onClick={() => {
                setFilter("overdue");
                setKind("all");
              }}
              className={overdue.length ? "needs-review" : ""}
            >
              <Clock size={18} />
              <span>Past due</span>
              <strong>{overdue.length}</strong>
              <small>Review the next handoff</small>
            </button>
            <button
              onClick={() => {
                setFilter("open");
                setKind("we_owe");
              }}
            >
              <CheckCircle2 size={18} />
              <span>Open We Owe</span>
              <strong>{open.filter((o) => o.kind === "we_owe").length}</strong>
              <small>Promises waiting to be fulfilled</small>
            </button>
            <button
              onClick={() => {
                setFilter("unpaid");
                setKind("customer_pay");
              }}
            >
              <span>Invoice balances</span>
              <strong>
                {fullMoney(
                  orders
                    .filter(
                      (o) =>
                        o.kind === "customer_pay" && o.status === "completed",
                    )
                    .reduce(
                      (n, o) =>
                        n +
                        Math.max(
                          0,
                          serviceTotals(o).total - servicePaid(ws, o.id),
                        ),
                      0,
                    ),
                )}
              </strong>
              <small>Completed orders less recorded receipts</small>
            </button>
          </div>
          <div className="business-toolbar">
            <label>
              Search work
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Customer, VIN, stock, vendor…"
              />
            </label>
            <label>
              Show
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="open">Open work</option>
                <option value="overdue">Past due</option>
                <option value="unpaid">Completed invoice balance due</option>
                <option value="completed">Completed history</option>
                <option value="all">All orders</option>
              </select>
            </label>
            <label>
              Work type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">All types</option>
                {Object.entries(serviceKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned to
              <select value={staff} onChange={(e) => setStaff(e.target.value)}>
                <option value="">Entire team</option>
                {ws.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {!s.active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              onClick={() =>
                downloadCsv(
                  "Drive-Max-Service.csv",
                  csvText([
                    [
                      "Order",
                      "Kind",
                      "Customer",
                      "Vehicle",
                      "Stock",
                      "VIN",
                      "Assigned to",
                      "Vendor",
                      "Due",
                      "Status",
                      "Estimated cost",
                      "Actual cost",
                      "Customer total",
                      "Recorded payments",
                    ],
                    ...rows.map((o) => [
                      serviceLabel(o),
                      serviceKinds[o.kind],
                      o.customer_name,
                      o.vehicle,
                      o.stock_number,
                      o.vin,
                      ws.staff.find((s) => s.id === o.assigned_to)?.name ??
                        "Unassigned",
                      o.vendor,
                      o.due_on,
                      serviceStatuses[o.status],
                      serviceTotals(o).estimate,
                      serviceTotals(o).actual,
                      serviceTotals(o).total,
                      servicePaid(ws, o.id),
                    ]),
                  ]),
                )
              }
            >
              <Download size={15} />
              Export
            </button>
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    {[
                      "Order / type",
                      "Customer / vehicle",
                      "Work / promise",
                      "Assigned / location",
                      "Due",
                      "Status",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{serviceLabel(o)}</strong>
                        <small>{serviceKinds[o.kind]}</small>
                      </td>
                      <td>
                        {o.customer_name || "Inventory"}
                        <small>
                          {o.vehicle} · {o.stock_number}
                        </small>
                      </td>
                      <td className="service-concern">{o.concern}</td>
                      <td>
                        {ws.staff.find((s) => s.id === o.assigned_to)?.name ??
                          "Unassigned"}
                        <small>{o.vendor || "In house / vendor not set"}</small>
                      </td>
                      <td>
                        <span
                          className={
                            o.due_on && o.due_on < today && serviceOpen(o)
                              ? "overdue-text"
                              : ""
                          }
                        >
                          {o.due_on ?? "Not set"}
                        </span>
                      </td>
                      <td>
                        <span className={`service-status ${o.status}`}>
                          {serviceStatuses[o.status]}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn small"
                          onClick={() => setSelected(o.id)}
                        >
                          View order
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No repair orders in this view"
              body="Create an inventory repair, customer service order, warranty job, or We Owe promise."
            />
          )}
        </>
      )}
      {editor && (
        <ServiceOrderEditor
          key={"id" in editor ? editor.id : "new"}
          ws={ws}
          initial={editor}
          run={run}
          busy={busy}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            setSelected(id);
          }}
        />
      )}
    </section>
  );
}
export function ServiceOrderEditor({
  ws,
  initial,
  run,
  busy,
  onClose,
  onSaved,
}: {
  ws: Workspace;
  initial: ServiceOrder | ServiceInput;
  run: ManagementRun;
  busy: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ServiceInput>(() =>
      structuredClone(initial),
    ),
    [id] = useState(() => ("id" in initial ? initial.id : crypto.randomUUID())),
    [error, setError] = useState("");
  const existing = "id" in initial ? initial : null,
    totals = serviceTotals(draft),
    patch = (v: Partial<ServiceInput>) => setDraft((d) => ({ ...d, ...v }));
  const item = (id: string, v: Partial<ServiceLine>) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, ...v } : i)),
    }));
  return (
    <Modal
      title={existing ? `Edit ${serviceLabel(existing)}` : "New repair order"}
      subtitle="Record the scope and estimate first. Authorization and progress follow after saving."
      wide
      onClose={onClose}
      className="management-modal"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = serviceOrderSchema.safeParse(draft);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          const result = await run(
            {
              type: "save_service_order",
              request_id: crypto.randomUUID(),
              id,
              revision: existing?.revision ?? 0,
              order: parsed.data,
            },
            "Repair order saved",
          );
          if (result.ok) onSaved ? onSaved(id) : onClose();
          else
            setError(
              result.error ?? "Could not save. Refresh if this order changed.",
            );
        }}
      >
        <div className="form-grid">
          <label>
            Work type
            <select
              value={draft.kind}
              onChange={(e) =>
                patch({ kind: e.target.value as ServiceInput["kind"] })
              }
            >
              {Object.entries(serviceKinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <select
              value={draft.customer_id ?? ""}
              onChange={(e) =>
                patch({
                  customer_id: e.target.value || null,
                  opportunity_id: null,
                })
              }
            >
              <option value="">Inventory / no customer</option>
              {ws.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Related opportunity
            <select
              value={draft.opportunity_id ?? ""}
              onChange={(e) => {
                const o = ws.opportunities.find((o) => o.id === e.target.value);
                patch({
                  opportunity_id: o?.id ?? null,
                  ...(o
                    ? {
                        vehicle: o.vehicle_interest || draft.vehicle,
                        inventory_id: o.inventory_id ?? draft.inventory_id,
                      }
                    : {}),
                });
              }}
            >
              <option value="">General service / no deal</option>
              {ws.opportunities
                .filter((o) => o.customer_id === draft.customer_id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.vehicle_interest || o.title} · {o.status}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Inventory vehicle
            <select
              value={draft.inventory_id ?? ""}
              onChange={(e) => {
                const v = ws.inventory.find((v) => v.id === e.target.value);
                patch({
                  inventory_id: v?.id ?? null,
                  ...(v
                    ? {
                        vehicle: vehicleName(v),
                        vin: v.vin,
                        stock_number: v.stock_number,
                        mileage: v.mileage,
                      }
                    : {}),
                });
              }}
            >
              <option value="">Customer vehicle / manual details</option>
              {ws.inventory.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.stock_number} · {vehicleName(v)} · {v.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle
            <input
              required
              value={draft.vehicle}
              onChange={(e) => patch({ vehicle: e.target.value })}
            />
          </label>
          <label>
            VIN
            <input
              maxLength={17}
              value={draft.vin}
              onChange={(e) => patch({ vin: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            Stock number
            <input
              value={draft.stock_number}
              onChange={(e) => patch({ stock_number: e.target.value })}
            />
          </label>
          <label>
            Odometer
            <input
              type="number"
              min="0"
              max="3000000"
              value={draft.mileage ?? ""}
              onChange={(e) =>
                patch({
                  mileage:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Assigned owner
            <select
              value={draft.assigned_to ?? ""}
              onChange={(e) => patch({ assigned_to: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {ws.staff
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Shop / vendor
            <input
              placeholder="In house or outside repair shop"
              value={draft.vendor}
              onChange={(e) => patch({ vendor: e.target.value })}
            />
          </label>
          <label>
            Promised / due date
            <input
              type="date"
              value={draft.due_on ?? ""}
              onChange={(e) => patch({ due_on: e.target.value || null })}
            />
          </label>
        </div>
        <label>
          Customer concern or We Owe promise
          <textarea
            required
            value={draft.concern}
            onChange={(e) => patch({ concern: e.target.value })}
            placeholder="What work did we agree to perform?"
          />
        </label>
        <label>
          Findings / work performed
          <textarea
            value={draft.findings}
            onChange={(e) => patch({ findings: e.target.value })}
          />
        </label>
        <SectionTitle
          title="Labor, parts & outside repairs"
          subtitle="Costs are internal. Customer unit prices appear on the estimate or invoice."
          action={
            <button
              type="button"
              className="btn small"
              onClick={() =>
                patch({
                  items: [
                    ...draft.items,
                    {
                      id: crypto.randomUUID(),
                      kind: "parts",
                      description: "",
                      quantity: 1,
                      estimated_cost: 0,
                      actual_cost: null,
                      price: 0,
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              Add item
            </button>
          }
        />
        <div className="service-line-list">
          {draft.items.map((i, index) => (
            <fieldset key={i.id}>
              <legend>Item {index + 1}</legend>
              <div className="service-line-main">
                <label>
                  Type
                  <select
                    value={i.kind}
                    onChange={(e) =>
                      item(i.id, {
                        kind: e.target.value as ServiceLine["kind"],
                      })
                    }
                  >
                    {["labor", "parts", "sublet", "fee"].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Description
                  <input
                    required
                    value={i.description}
                    onChange={(e) =>
                      item(i.id, { description: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={draft.items.length === 1}
                  onClick={() =>
                    patch({ items: draft.items.filter((x) => x.id !== i.id) })
                  }
                >
                  Remove
                </button>
              </div>
              <div className="form-grid four">
                <label>
                  Quantity / hours
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={i.quantity}
                    onChange={(e) =>
                      item(i.id, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Estimated unit cost
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={i.estimated_cost}
                    onChange={(e) =>
                      item(i.id, { estimated_cost: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Actual unit cost
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={i.actual_cost ?? ""}
                    placeholder="Pending"
                    onChange={(e) =>
                      item(i.id, {
                        actual_cost:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Customer unit price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={i.price}
                    onChange={(e) =>
                      item(i.id, { price: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
        <div className="form-grid">
          <label>
            Tax amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.tax}
              onChange={(e) => patch({ tax: Number(e.target.value) })}
            />
            <small>
              Enter the reviewed tax amount for this service invoice.
            </small>
          </label>
          <label>
            Internal notes
            <textarea
              value={draft.internal_notes}
              onChange={(e) => patch({ internal_notes: e.target.value })}
            />
          </label>
        </div>
        <div className="management-summary">
          <span>
            Estimated cost <strong>{fullMoney(totals.estimate)}</strong>
          </span>
          <span>
            Actual cost{" "}
            <strong>
              {totals.actual === null ? "Pending" : fullMoney(totals.actual)}
            </strong>
          </span>
          <span>
            Customer total <strong>{fullMoney(totals.total)}</strong>
          </span>
        </div>
        {existing?.authorization && (
          <p className="work-note">
            Changing the agreed work, estimate, customer prices, or vehicle
            requires a new authorization. Updating actual costs, findings,
            assignment, or dates preserves it.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            <Save size={15} />
            Save repair order
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ServiceDetail({
  order: o,
  ws,
  run,
  busy,
  onBack,
  onEdit,
  onCustomer,
}: {
  order: ServiceOrder;
  ws: Workspace;
  run: ManagementRun;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCustomer?: (id: string, opportunity?: string) => void;
}) {
  const [action, setAction] = useState<
      "authorize" | "status" | "receipt" | "recon" | null
    >(null),
    [print, setPrint] = useState<"customer" | "internal" | null>(null),
    [reverse, setReverse] = useState<string | null>(null),
    [error, setError] = useState("");
  const totals = serviceTotals(o),
    paid = servicePaid(ws, o.id),
    open = serviceOpen(o),
    receipts = (ws.service_receipts ?? []).filter((r) => r.order_id === o.id),
    events = (ws.management_events ?? [])
      .filter((e) => e.subject_id === o.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const v = ws.inventory.find((v) => v.id === o.inventory_id),
    completedRecon = (ws.service_orders ?? [])
      .filter(
        (r) =>
          r.inventory_id === o.inventory_id &&
          r.kind === "reconditioning" &&
          r.status === "completed",
      )
      .reduce((n, r) => n + (serviceTotals(r).actual ?? 0), 0);
  async function submit(p: Command) {
    const result = await run(p, "Service order updated");
    if (result.ok) {
      setAction(null);
      setReverse(null);
      setError("");
    } else
      setError(
        result.error ?? "Could not save. Refresh if the record changed.",
      );
  }
  const base = () => ({
    id: o.id,
    revision: o.revision,
    request_id: crypto.randomUUID(),
  });
  return (
    <>
      <button className="text-btn" onClick={onBack}>
        <ArrowLeft size={15} />
        All repair orders
      </button>
      <div className="service-detail-heading">
        <div>
          <span className="eyebrow">
            {serviceKinds[o.kind]} · {serviceLabel(o)}
          </span>
          <h2>{o.vehicle}</h2>
          <p>
            {o.customer_name || "Drive Max inventory"} ·{" "}
            {o.stock_number || "No stock number"} ·{" "}
            {o.vin || "VIN not recorded"}
          </p>
        </div>
        <span className={`service-status ${o.status}`}>
          {serviceStatuses[o.status]}
        </span>
      </div>
      <div className="ops-actions service-actions">
        {open && (
          <>
            <button className="btn" onClick={onEdit}>
              Edit work / costs
            </button>
            <button className="btn" onClick={() => setAction("authorize")}>
              {o.authorization
                ? "Update authorization"
                : "Record authorization"}
            </button>
            <button className="btn primary" onClick={() => setAction("status")}>
              Update progress
            </button>
          </>
        )}
        <button className="btn" onClick={() => setPrint("customer")}>
          <Printer size={15} />
          {o.status === "completed"
            ? "Customer invoice / copy"
            : "Customer estimate / promise"}
        </button>
        <button className="btn" onClick={() => setPrint("internal")}>
          Internal work order
        </button>
        {o.customer_id && onCustomer && (
          <button
            className="btn"
            onClick={() =>
              onCustomer(o.customer_id!, o.opportunity_id ?? undefined)
            }
          >
            Open customer
          </button>
        )}
      </div>
      <div className="management-summary">
        <span>
          Assigned to
          <strong>
            {ws.staff.find((s) => s.id === o.assigned_to)?.name ?? "Unassigned"}
          </strong>
        </span>
        <span>
          Shop / location<strong>{o.vendor || "Not set"}</strong>
        </span>
        <span>
          Promised / due<strong>{o.due_on ?? "Not set"}</strong>
        </span>
        <span>
          Completed
          <strong>{o.completed_at ? stamp(o.completed_at) : "Open"}</strong>
        </span>
      </div>
      <div className="service-detail-grid">
        <section className="management-inset">
          <h3>Agreed work / promise</h3>
          <p className="preserve-lines">{o.concern}</p>
          <h3>Findings / work performed</h3>
          <p className="preserve-lines">
            {o.findings || "No findings recorded yet."}
          </p>
          {o.internal_notes && (
            <>
              <h3>Internal notes</h3>
              <p className="preserve-lines">{o.internal_notes}</p>
            </>
          )}
        </section>
        <section className="management-inset">
          <h3>Authorization</h3>
          {o.authorization ? (
            <>
              <p>
                <strong>{o.authorization.by}</strong> ·{" "}
                {o.authorization.method.replaceAll("_", " ")}
              </p>
              <p>
                Authorized limit:{" "}
                <strong>{fullMoney(o.authorization.limit)}</strong>
              </p>
              <small>{stamp(o.authorization.at)} Eastern</small>
              <p>{o.authorization.notes}</p>
            </>
          ) : (
            <p>
              Record customer authorization for customer-pay work, or internal
              approval for inventory, warranty, and We Owe work.
            </p>
          )}
          {o.canceled_reason && <p>Cancellation reason: {o.canceled_reason}</p>}
        </section>
      </div>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              {[
                "Work item",
                "Qty / hrs",
                "Est. unit cost",
                "Actual unit cost",
                "Customer unit price",
                "Customer line total",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.description}
                  <small>{i.kind}</small>
                </td>
                <td>{i.quantity}</td>
                <td>{fullMoney(i.estimated_cost)}</td>
                <td>
                  {i.actual_cost === null
                    ? "Pending"
                    : fullMoney(i.actual_cost)}
                </td>
                <td>{fullMoney(i.price)}</td>
                <td>{fullMoney(i.quantity * i.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="management-summary">
        <span>
          Estimated cost<strong>{fullMoney(totals.estimate)}</strong>
        </span>
        <span>
          Actual cost
          <strong>
            {totals.actual === null ? "Pending" : fullMoney(totals.actual)}
          </strong>
        </span>
        <span>
          Customer total incl. tax<strong>{fullMoney(totals.total)}</strong>
        </span>
        {o.kind === "customer_pay" && (
          <span>
            {paid > totals.total ? "Overpayment" : "Balance due"}
            <strong>{fullMoney(Math.abs(totals.total - paid))}</strong>
          </span>
        )}
      </div>
      {o.kind === "reconditioning" &&
        o.status === "completed" &&
        v &&
        ["in_stock", "pending"].includes(v.status) && (
          <section className="management-inset">
            <h3>Inventory recon total</h3>
            <p>
              Inventory currently records {fullMoney(v.recon)}. Completed recon
              orders for this vehicle total {fullMoney(completedRecon)}. Review
              other costs before replacing the inventory total.
            </p>
            <button className="btn" onClick={() => setAction("recon")}>
              Review & apply recon total
            </button>
          </section>
        )}
      {o.kind === "customer_pay" && o.status === "completed" && (
        <section className="management-inset">
          <SectionTitle
            title="Recorded payments"
            subtitle="Record money already received. This does not charge a card or move money."
            action={
              <button className="btn" onClick={() => setAction("receipt")}>
                Record payment
              </button>
            }
          />
          {receipts.length ? (
            <div className="table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method / reference</th>
                    <th>Amount</th>
                    <th>Notes</th>
                    <th>Correction</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td>{r.received_on}</td>
                      <td>
                        {r.method}
                        <small>{r.reference}</small>
                      </td>
                      <td>
                        {r.reversal_of ? "−" : ""}
                        {fullMoney(r.amount)}
                      </td>
                      <td>{r.notes}</td>
                      <td>
                        {!r.reversal_of &&
                          !receipts.some((x) => x.reversal_of === r.id) && (
                            <button
                              className="btn small"
                              onClick={() => setReverse(r.id)}
                            >
                              Reverse entry
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No payments recorded.</p>
          )}
        </section>
      )}
      <details className="management-history">
        <summary>Change history ({events.length})</summary>
        {events.map((e) => (
          <p key={e.id}>
            <strong>{e.action.replaceAll("_", " ")}</strong> ·{" "}
            {stamp(e.created_at)} ·{" "}
            {ws.staff.find((s) => s.user_id === e.created_by)?.name ??
              "Manager"}
            {e.before_value && (
              <small>Previous state retained in the audit record.</small>
            )}
          </p>
        ))}
      </details>
      {(action || reverse) && (
        <Modal
          title={
            reverse
              ? "Reverse recorded payment"
              : action === "authorize"
                ? "Record authorization"
                : action === "status"
                  ? "Update work progress"
                  : action === "recon"
                    ? "Review inventory recon total"
                    : "Record payment received"
          }
          onClose={() => {
            setAction(null);
            setReverse(null);
            setError("");
          }}
          className="management-modal"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                str = (key: string) => String(f.get(key) ?? "");
              if (reverse)
                await submit({
                  ...base(),
                  type: "reverse_service_receipt",
                  receipt_id: crypto.randomUUID(),
                  original_id: reverse,
                  received_on: str("date"),
                  reason: str("notes"),
                });
              else if (action === "authorize")
                await submit({
                  ...base(),
                  type: "authorize_service_order",
                  by: str("by"),
                  method: str("method") as ServiceAuthorization["method"],
                  limit: Number(f.get("limit")),
                  notes: str("notes"),
                });
              else if (action === "status")
                await submit({
                  ...base(),
                  type: "set_service_status",
                  status: str("status") as ServiceOrder["status"],
                  reason: str("notes"),
                });
              else if (action === "recon" && v)
                await submit({
                  type: "apply_service_recon",
                  request_id: crypto.randomUUID(),
                  inventory_id: v.id,
                  expected_updated_at: v.updated_at,
                  other_costs: Number(f.get("other")),
                });
              else
                await submit({
                  ...base(),
                  type: "record_service_receipt",
                  receipt_id: crypto.randomUUID(),
                  amount: Number(f.get("amount")),
                  received_on: str("date"),
                  method: str("method") as "Cash",
                  reference: str("reference"),
                  notes: str("notes"),
                });
            }}
          >
            {action === "authorize" && (
              <>
                <label>
                  Authorized by
                  <input
                    name="by"
                    required
                    defaultValue={
                      o.kind === "customer_pay"
                        ? o.customer_name
                        : ws.member.name
                    }
                  />
                </label>
                <label>
                  How received
                  <select
                    name="method"
                    defaultValue={
                      o.kind === "customer_pay" ? "in_person" : "internal"
                    }
                  >
                    <option value="in_person">In person</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="written">Written</option>
                    <option value="internal">Internal manager approval</option>
                  </select>
                </label>
                <label>
                  Authorized limit
                  <input
                    name="limit"
                    type="number"
                    min={Math.max(
                      serviceLimitBasis(o),
                      o.kind === "customer_pay" ? 0 : (totals.actual ?? 0),
                    )}
                    max="1000000"
                    step="0.01"
                    required
                    defaultValue={Math.max(
                      serviceLimitBasis(o),
                      o.kind === "customer_pay" ? 0 : (totals.actual ?? 0),
                      o.authorization?.limit ?? 0,
                    )}
                  />
                </label>
                <p className="work-note">
                  This records an authorization you have received. It does not
                  request or collect an electronic signature.
                </p>
              </>
            )}
            {action === "status" && (
              <>
                <label>
                  New status
                  <select name="status" defaultValue={o.status}>
                    {Object.entries(serviceStatuses).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="work-note">
                  Completing requires actual costs and authorization. Completed
                  orders keep their saved work and cost details.
                </p>
              </>
            )}
            {(action === "receipt" || reverse) && (
              <>
                <label>
                  Date received / corrected
                  <input
                    name="date"
                    type="date"
                    required
                    max={dayKey()}
                    defaultValue={dayKey()}
                  />
                </label>
                {!reverse && (
                  <>
                    <label>
                      Amount received
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        defaultValue={Math.max(0, totals.total - paid)}
                      />
                    </label>
                    <label>
                      Method
                      <select name="method">
                        {["Cash", "Check", "Card", "ACH", "Other"].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reference
                      <input name="reference" />
                    </label>
                  </>
                )}
              </>
            )}
            {action === "recon" ? (
              <>
                <p>
                  Completed recon orders:{" "}
                  <strong>{fullMoney(completedRecon)}</strong>
                </p>
                <p>Current inventory recon: {fullMoney(v?.recon ?? 0)}</p>
                <label>
                  Other recon costs not included in these orders
                  <input
                    name="other"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={Math.max(0, (v?.recon ?? 0) - completedRecon)}
                  />
                </label>
                <p className="work-note">
                  The new inventory total will be completed repair-order costs
                  plus this amount. Review any costs already included in
                  Inventory Preparation to avoid counting them twice.
                </p>
              </>
            ) : (
              <label>
                {reverse
                  ? "Correction reason"
                  : action === "status"
                    ? "Reason (required for cancellation)"
                    : "Authorization / payment notes"}
                <textarea
                  name="notes"
                  required={!!reverse}
                  minLength={reverse ? 3 : undefined}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAction(null);
                  setReverse(null);
                }}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {print && (
        <PrintDocument onClose={() => setPrint(null)}>
          <ServicePrint
            order={o}
            paid={paid}
            internal={print === "internal"}
            dealership={ws.org.name}
          />
        </PrintDocument>
      )}
    </>
  );
}
function ServicePrint({
  order: o,
  paid,
  internal,
  dealership,
}: {
  order: ServiceOrder;
  paid: number;
  internal: boolean;
  dealership: string;
}) {
  const t = serviceTotals(o);
  return (
    <div className="service-print">
      <header>
        <div>
          <h1>{dealership}</h1>
          <p>Service &amp; We Owe</p>
        </div>
        <div>
          <h2>
            {internal
              ? "INTERNAL WORK ORDER"
              : o.kind === "we_owe"
                ? "WE OWE"
                : o.status === "completed"
                  ? "SERVICE INVOICE"
                  : "SERVICE ESTIMATE"}
          </h2>
          <strong>{serviceLabel(o)}</strong>
          <p>{serviceStatuses[o.status]}</p>
        </div>
      </header>
      <div className="service-print-identity">
        <p>
          <strong>{o.customer_name || "Drive Max inventory"}</strong>
          <br />
          {o.vehicle}
          <br />
          VIN: {o.vin || "—"}
          <br />
          Stock: {o.stock_number || "—"} · Odometer:{" "}
          {o.mileage?.toLocaleString() ?? "—"}
        </p>
        <p>
          Created: {dayKey(o.created_at)}
          <br />
          Promised / due: {o.due_on ?? "To be arranged"}
          <br />
          Completed: {o.completed_at ? dayKey(o.completed_at) : "—"}
        </p>
      </div>
      <h3>Agreed work / promise</h3>
      <p className="preserve-lines">{o.concern}</p>
      {o.findings && (
        <>
          <h3>Work performed / findings</h3>
          <p className="preserve-lines">{o.findings}</p>
        </>
      )}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty / hours</th>
            <th>Unit price</th>
            <th>Total</th>
            {internal && <th>Actual cost</th>}
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>{i.description}</td>
              <td>{i.quantity}</td>
              <td>{fullMoney(i.price)}</td>
              <td>{fullMoney(i.quantity * i.price)}</td>
              {internal && (
                <td>
                  {i.actual_cost === null
                    ? "Pending"
                    : fullMoney(i.quantity * i.actual_cost)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="service-print-totals">
        <p>
          Subtotal <strong>{fullMoney(t.subtotal)}</strong>
        </p>
        <p>
          Tax <strong>{fullMoney(o.tax)}</strong>
        </p>
        <p>
          Total <strong>{fullMoney(t.total)}</strong>
        </p>
        {o.kind === "customer_pay" && (
          <>
            <p>
              Payments recorded <strong>{fullMoney(paid)}</strong>
            </p>
            <p>
              {paid > t.total ? "Overpayment" : "Balance due"}
              <strong>{fullMoney(Math.abs(t.total - paid))}</strong>
            </p>
          </>
        )}
      </div>
      {o.authorization && (
        <p>
          Authorization recorded: {o.authorization.by} ·{" "}
          {o.authorization.method.replaceAll("_", " ")} ·{" "}
          {dayKey(o.authorization.at)}
        </p>
      )}
      {internal && (
        <>
          <h3>Internal notes</h3>
          <p>{o.internal_notes || "—"}</p>
          <p>
            Estimated cost: {fullMoney(t.estimate)} · Actual cost:{" "}
            {t.actual === null ? "Pending" : fullMoney(t.actual)}
          </p>
          <p>Vendor: {o.vendor || "—"}</p>
        </>
      )}
      <div className="service-signatures">
        <span>
          Customer signature ______________________
          <br />
          Date ______________________
        </span>
        <span>
          Dealership representative ______________________
          <br />
          Date ______________________
        </span>
      </div>
    </div>
  );
}
