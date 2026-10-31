"use client";
import { FacebookThread } from "./FacebookThread";
import { customerActivity } from "../lib/activity";
import { CustomerWorkflows } from "./WorkflowSettings";
import { BuyerPreferences } from "./BuyerMatches";
import { ServiceWorkspace } from "./ServiceWorkspace";
import { DealDelivery } from "./DealDelivery";
import { useState } from "react";
import {
  Plus,
  Phone,
  Mail,
  Printer,
  DoorOpen,
  LogOut,
  CheckCircle2,
  FileText,
  StickyNote,
  MessageSquare,
  Car,
  ArrowLeftRight,
  Pencil,
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Command,
  type Opportunity,
  type Quote,
  type Task,
  opportunityOpen,
  opportunityCustomer,
  dayKey,
  isOpenTask,
  canManage,
  myStaffId,
  visibleTasks,
} from "../lib/model";
import { personFromCustomer, fullName } from "../lib/people";
import { Avatar, Badge, Modal, Empty } from "./ui";
import { CustomerForm } from "./CustomerForm";
import { CustomerLicense } from "./CustomerLicense";
import { CoBuyerDialog } from "./CoBuyerPicker";
import { MergeCustomers } from "./MergeCustomers";
import { AppointmentDialog, CustomerAppointments } from "./Appointments";
import type { Appointment } from "../lib/appointments";
import { OpportunityForm } from "./OpportunityForm";
import { InsuranceForm } from "./InsuranceForm";
import {
  Communications,
  MessageComposer,
  CustomerTasks,
  TaskAction,
  type Compose,
} from "./Communications";
import { DealRecap } from "./DealRecap";
import { Desking } from "./Desking";
import dynamic from "next/dynamic";
const SoldPack = dynamic(() => import("./SoldPack").then((m) => m.SoldPack), {
  ssr: false,
});
type Tab =
  | "Activity"
  | "Details"
  | "Desking"
  | "Insurance"
  | "Texts"
  | "Emails"
  | "Facebook"
  | "Follow-up"
  | "Wish list"
  | "Delivery"
  | "Service";
export function CustomerProfile({
  ws,
  customer,
  demo,
  busy,
  error,
  run,
  onClose,
  onPrintQuote,
  onRefresh,
  onOpenCustomer,
  initialTab = "Activity",
  initialOpportunityId,
  initialNewOpportunity = false,
}: {
  ws: Workspace;
  customer: Customer;
  demo: boolean;
  busy: boolean;
  error: string;
  run: (p: Command, message?: string) => Promise<{ ok: boolean; id?: string }>;
  onClose: () => void;
  onPrintQuote: (c: Customer, q: Quote) => void;
  onRefresh?: () => Promise<void>;
  onOpenCustomer?: (customer: Customer, opportunityId?: string | null) => void;
  initialTab?: Tab;
  initialOpportunityId?: string | null;
  initialNewOpportunity?: boolean;
}) {
  const [compose, setCompose] = useState<Compose | null>(null),
    [appointmentDialog, setAppointmentDialog] = useState<
      Appointment | "new" | null
    >(null),
    [taskAction, setTaskAction] = useState<Task | null>(null),
    [recap, setRecap] = useState<string | null>(null),
    [unwindReason, setUnwindReason] = useState("");
  const opportunities = ws.opportunities
      .filter((o) => o.customer_id === customer.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    active = opportunities.filter(opportunityOpen);
  const [selected, setSelected] = useState<string | null>(
      () =>
        initialOpportunityId ?? active[0]?.id ?? opportunities[0]?.id ?? null,
    ),
    [tab, setTab] = useState<Tab>(initialTab),
    [modal, setModal] = useState<
      | "unwind"
      | "customer"
      | "merge"
      | "co-buyer"
      | "new-opportunity"
      | "edit-opportunity"
      | "edit-vehicle"
      | "edit-trade"
      | "sold"
      | "lost"
      | "pack"
      | "pack-choice"
      | "mvr2"
      | "task"
      | null
    >(initialNewOpportunity ? "new-opportunity" : null),
    [packVariant, setPackVariant] = useState<"with-trade" | "without-trade">(
      "without-trade",
    ),
    [note, setNote] = useState(""),
    [kind, setKind] = useState<"note" | "call" | "email" | "sms">("note"),
    [reason, setReason] = useState("");
  const o = opportunities.find((o) => o.id === selected),
    effective = o ? opportunityCustomer(customer, o) : customer,
    closed = !!o && !opportunityOpen(o),
    visit = ws.visits.find(
      (v) => v.customer_id === customer.id && !v.departed_at,
    ),
    activities = customerActivity(ws, customer.id);
  const manager = canManage(ws.member.role),
    me = myStaffId(ws),
    assigned = o ? o.assigned_to : customer.assigned_to;
  const person = personFromCustomer(effective),
    co = effective.co_buyer;
  const interestVehicle = closed
    ? o?.vehicle_details
    : (ws.inventory.find((v) => v.id === o?.inventory_id) ??
      o?.vehicle_details);
  function choose(id: string | null) {
    setSelected(id);
    setNote("");
    if (!id && tab === "Desking") setTab("Activity");
  }
  return (
    <>
      <Modal
        title="Customer profile"
        className="customer-profile-modal"
        wide
        onClose={onClose}
      >
        <div className="profile-overview">
          <div className="profile-identity">
            <div className="profile-top">
              <CustomerLicense
                customerId={customer.id}
                name={customer.name}
                demo={demo}
              />
              <div>
                <h2>{customer.name}</h2>
                <div className="profile-tags">
                  <span
                    className={
                      active.length
                        ? "active-opportunity-tag"
                        : "no-opportunity-tag"
                    }
                  >
                    {active.length
                      ? `${active.length} active ${active.length === 1 ? "opportunity" : "opportunities"}`
                      : "No active opportunity"}
                  </span>
                  <span>{customer.source}</span>
                </div>
              </div>
            </div>
            <div className="profile-contact">
              <span>
                <Phone size={14} />
                {customer.phone || "No phone added"}
              </span>
              <span>
                <Mail size={14} />
                {customer.email || "No email added"}
              </span>
            </div>
            <div className="profile-identity-actions">
              <button
                className="btn small"
                onClick={() => setModal("customer")}
              >
                Edit customer
              </button>
              {manager && (
                <button className="btn small" onClick={() => setModal("merge")}>
                  Merge duplicate
                </button>
              )}
            </div>
          </div>
          <CustomerAppointments
            ws={ws}
            customer={customer}
            onSchedule={() => setAppointmentDialog("new")}
            onOpen={setAppointmentDialog}
          />
        </div>
        {!!ws.customer_aliases?.some((a) => a.customer_id === customer.id) && (
          <details className="customer-aliases">
            <summary>Merged profile history</summary>
            {ws.customer_aliases
              .filter((a) => a.customer_id === customer.id)
              .map((a) => (
                <p key={a.id}>
                  <strong>{a.name}</strong> ·{" "}
                  {[a.phone, a.email].filter(Boolean).join(" · ") ||
                    "No contact details"}
                </p>
              ))}
          </details>
        )}
        {!!ws.opportunities.some((o) => o.co_buyer_id === customer.id) && (
          <section className="co-buyer-relationships">
            <h3>Deals as co-buyer</h3>
            {ws.opportunities
              .filter((o) => o.co_buyer_id === customer.id)
              .map((related) => {
                const buyer = ws.customers.find(
                  (c) => c.id === related.customer_id,
                );
                return (
                  buyer && (
                    <button
                      key={related.id}
                      type="button"
                      className="btn small"
                      onClick={() => onOpenCustomer?.(buyer, related.id)}
                    >
                      {related.title} · {buyer.name} · {related.status}
                    </button>
                  )
                );
              })}
          </section>
        )}
        <CustomerTasks ws={ws} customer={customer} onTask={setTaskAction} />

        <section className="opportunity-section">
          <h3>Opportunities</h3>
          <div className="opportunity-list">
            <button
              className={
                !selected ? "opportunity-chip selected" : "opportunity-chip"
              }
              aria-pressed={!selected}
              onClick={() => choose(null)}
            >
              <span>General customer</span>
              <small>Notes & communication</small>
            </button>
            {opportunities.map((item) => (
              <button
                className={`opportunity-chip ${item.id === selected ? "selected" : ""}`}
                key={item.id}
                aria-pressed={item.id === selected}
                onClick={() => choose(item.id)}
              >
                <span>{item.title}</span>
                <small>
                  <Badge value={item.status} />
                  {item.sold_on || dayKey(item.created_at)}
                </small>
              </button>
            ))}
          </div>
          <button
            className="btn primary small"
            onClick={() => setModal("new-opportunity")}
          >
            <Plus size={15} />
            New opportunity
          </button>
        </section>
        {o && (
          <div className="profile-deal-overview">
            <div className="opportunity-summary">
              <div>
                <span className="eyebrow">SELECTED OPPORTUNITY</span>
                <h3>{o.title}</h3>
                <p>
                  <Badge value={o.status} />
                  {o.sold_on
                    ? `Sold ${o.sold_on}`
                    : o.status === "lost"
                      ? o.lost_reason || "Closed without a sale"
                      : o.source}
                </p>
              </div>
              <label className="opportunity-assignee">
                Assigned salesperson
                <select
                  value={o.assigned_to ?? ""}
                  disabled={busy || !manager}
                  onChange={(e) =>
                    run(
                      {
                        type: "assign_opportunity",
                        id: o.id,
                        assigned_to: e.target.value || null,
                      },
                      "Salesperson and unfinished follow-ups updated",
                    )
                  }
                >
                  <option value="">Unassigned · manager queue</option>
                  {ws.staff
                    .filter((m) => m.active || m.id === o.assigned_to)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {!m.active ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              {!closed && (
                <button
                  className="btn small"
                  onClick={() => setModal("edit-opportunity")}
                >
                  Edit opportunity
                </button>
              )}
            </div>
            <div className="deal-co-buyer">
              <div>
                <strong>Co-buyer</strong>
                <span>
                  {co ? fullName(co) : "No co-buyer on this opportunity"}
                </span>
                {closed && <small>Recorded when this deal closed</small>}
              </div>
              {o.co_buyer_id &&
                ws.customers.some((c) => c.id === o.co_buyer_id) && (
                  <button
                    className="btn small"
                    onClick={() =>
                      onOpenCustomer?.(
                        ws.customers.find((c) => c.id === o.co_buyer_id)!,
                      )
                    }
                  >
                    Open co-buyer profile
                  </button>
                )}
              {!closed && (
                <button
                  className="btn small"
                  disabled={busy || (!manager && assigned !== me)}
                  onClick={() => setModal("co-buyer")}
                >
                  {co ? "Manage co-buyer" : "Add co-buyer"}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="profile-actions">
          {visit ? (
            <button
              className="btn small end-visit"
              disabled={busy}
              onClick={() =>
                run(
                  { type: "check_out", id: visit.id },
                  "Visit ended. Customer marked left.",
                )
              }
            >
              <LogOut size={15} />
              End visit
            </button>
          ) : (
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                run(
                  {
                    type: "check_in",
                    customer_id: customer.id,
                    opportunity_id: o && o.status !== "lost" ? o.id : null,
                  },
                  "Checked into the showroom",
                )
              }
            >
              <DoorOpen size={15} />
              Check in
            </button>
          )}
          <button
            className="btn small"
            disabled={!manager && assigned !== me}
            onClick={() => setModal("task")}
          >
            <Plus size={14} />
            Add task
          </button>
          <button
            className="btn small"
            onClick={() => {
              setTab("Activity");
              setKind("call");
            }}
          >
            <Phone size={14} />
            Log call
          </button>
          <button
            className="btn small"
            onClick={() => {
              setTab("Activity");
              setKind("email");
            }}
          >
            <MessageSquare size={14} />
            Communication
          </button>
          {o && (
            <>
              <button
                className="btn small"
                onClick={() => setModal("pack-choice")}
              >
                <Printer size={14} />
                Print sold pack
              </button>
              <button className="btn small" onClick={() => setModal("mvr2")}>
                <FileText size={14} />
                Print MVR-2
              </button>
              {!closed && (
                <>
                  <button
                    className="btn small success"
                    onClick={() => setModal("sold")}
                  >
                    <CheckCircle2 size={14} />
                    Mark sold
                  </button>
                  <button
                    className="btn small"
                    onClick={() => setModal("lost")}
                  >
                    Mark lost
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {o && (
          <div className="profile-vehicles">
            <button
              type="button"
              className="profile-vehicle-card interest-card"
              aria-label="Edit vehicle of interest"
              disabled={busy || closed}
              onClick={() => setModal("edit-vehicle")}
            >
              <span className="vehicle-card-heading">
                <small>VEHICLE OF INTEREST</small>
                <Car size={19} aria-hidden="true" />
              </span>
              <strong>{o.vehicle_interest || "Not selected yet"}</strong>
              <span className="vehicle-card-detail">
                {[
                  interestVehicle?.stock_number &&
                    `Stock #${interestVehicle.stock_number}`,
                  interestVehicle?.mileage != null &&
                    `${interestVehicle.mileage.toLocaleString()} miles`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Choose inventory or enter a vehicle"}
              </span>
              <span className="vehicle-card-action">
                {closed ? (
                  "Closed opportunity · read only"
                ) : (
                  <>
                    <Pencil size={13} aria-hidden="true" />
                    {o.vehicle_interest ? "Change vehicle" : "Select a vehicle"}
                  </>
                )}
              </span>
            </button>
            <button
              type="button"
              className="profile-vehicle-card trade-card"
              aria-label="Edit trade-in"
              disabled={busy || closed}
              onClick={() => setModal("edit-trade")}
            >
              <span className="vehicle-card-heading">
                <small>TRADE-IN</small>
                <ArrowLeftRight size={19} aria-hidden="true" />
              </span>
              <strong>{o.trade_vehicle || "No trade-in"}</strong>
              <span className="vehicle-card-detail">
                {o.trade
                  ? `${o.trade.vin} · ${o.trade.mileage.toLocaleString()} miles`
                  : "Add the customer's trade vehicle"}
              </span>
              <span className="vehicle-card-action">
                {closed ? (
                  "Closed opportunity · read only"
                ) : (
                  <>
                    <Pencil size={13} aria-hidden="true" />
                    {o.trade_vehicle ? "Edit trade details" : "Add a trade-in"}
                  </>
                )}
              </span>
            </button>
          </div>
        )}
        {o && (
          <div className="ops-deal-history">
            {o.status === "sold" && manager && (
              <button
                className="btn small ops-danger"
                onClick={() => {
                  setUnwindReason("");
                  setModal("unwind");
                }}
              >
                Unwind sold deal
              </button>
            )}
            {(ws.sales ?? [])
              .filter((s) => s.opportunity_id === o.id)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((s) => (
                <div key={s.id}>
                  <span>
                    {s.status === "sold" ? "Sold" : "Sold, then unwound"} ·{" "}
                    {s.sold_on}
                    {s.status === "unwound" ? " · " + s.unwind_reason : ""}
                  </span>
                  {manager && (
                    <button
                      className="btn small"
                      onClick={() => setRecap(s.id)}
                    >
                      Deal recap / commissions
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
        <div className="profile-tabs">
          {(
            [
              "Activity",
              "Details",
              "Desking",
              "Insurance",
              "Texts",
              "Emails",
              "Facebook",
              "Follow-up",
              "Wish list",
              "Delivery",
              "Service",
            ] as Tab[]
          )
            .filter(
              (t) =>
                (!!o || (t !== "Desking" && t !== "Delivery")) &&
                (t !== "Service" || canManage(ws.member.role)),
            )
            .map((t) => (
              <button
                key={t}
                className={t === tab ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
        </div>
        {error && (
          <p className="form-error profile-error" role="alert">
            {error}
          </p>
        )}
        {tab === "Follow-up" && (
          <CustomerWorkflows
            ws={ws}
            customerId={customer.id}
            run={run}
            busy={busy}
          />
        )}
        {tab === "Wish list" && (
          <BuyerPreferences
            key={customer.id}
            ws={ws}
            customer={customer}
            run={run}
            busy={busy}
          />
        )}
        {tab === "Service" && (
          <ServiceWorkspace
            key={customer.id}
            ws={ws}
            run={run}
            busy={busy}
            customerId={customer.id}
            opportunityId={o?.id}
          />
        )}
        {tab === "Delivery" && o && (
          <DealDelivery
            key={o.id}
            ws={ws}
            opportunity={o}
            run={run}
            busy={busy}
            demo={demo}
            onRefresh={onRefresh}
          />
        )}
        {tab === "Facebook" && (
          <FacebookThread
            ws={ws}
            customerId={customer.id}
            busy={busy}
            onRefresh={onRefresh}
          />
        )}
        {(tab === "Texts" || tab === "Emails") && (
          <Communications
            run={run}
            busy={busy}
            onRefresh={onRefresh}
            key={tab}
            ws={ws}
            customer={customer}
            channel={tab === "Texts" ? "sms" : "email"}
            onCompose={setCompose}
          />
        )}
        {tab === "Activity" && (
          <div className="profile-body">
            <form
              className="note-composer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  (
                    await run(
                      {
                        type: "add_activity",
                        customer_id: customer.id,
                        opportunity_id: o?.id ?? null,
                        kind,
                        body: note,
                      },
                      kind === "note" ? "Note added" : "Communication logged",
                    )
                  ).ok
                )
                  setNote("");
              }}
            >
              <div className="composer-header">
                <label htmlFor="profile-note">
                  {o
                    ? `Add to ${o.title}`
                    : "Add a customer note or conversation"}
                </label>
                <select
                  aria-label="Activity type"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="note">Note</option>
                  <option value="call">Call log</option>
                  <option value="email">Email log</option>
                  <option value="sms">Text message log</option>
                </select>
              </div>
              {(kind === "email" || kind === "sms") && (
                <p className="fine-print">
                  Record an incoming or outgoing message here. Email and SMS
                  sending are not connected.
                </p>
              )}
              <textarea
                id="profile-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={8000}
                placeholder={
                  kind === "note"
                    ? "Remember a detail or capture the next step…"
                    : "Direction, outcome, and conversation details…"
                }
                required
              />
              <div>
                <span>
                  {o
                    ? "Saved to this opportunity"
                    : "Saved to the customer, outside an opportunity"}
                </span>
                <button
                  className="btn primary small"
                  disabled={busy || !note.trim()}
                >
                  {kind === "note" ? "Add note" : "Save communication log"}
                </button>
              </div>
            </form>
            <h3 className="timeline-title">All activity</h3>
            <div className="timeline">
              {activities.map((a) => (
                <article key={a.id}>
                  <span className={`timeline-dot ${a.kind}`}>
                    {a.kind === "call" ? (
                      <Phone size={14} />
                    ) : a.kind === "system" ? (
                      <CheckCircle2 size={14} />
                    ) : a.kind === "note" ? (
                      <StickyNote size={14} />
                    ) : (
                      <MessageSquare size={14} />
                    )}
                  </span>
                  <div>
                    <header>
                      <strong>{a.label}</strong>
                      <time>
                        {new Date(a.created_at).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </header>
                    <p>{a.body}</p>
                    <small>
                      {a.context} · {a.created_by}
                    </small>
                  </div>
                </article>
              ))}
            </div>
            {!activities.length && (
              <p className="muted-copy">
                No activity yet. Add the first note above.
              </p>
            )}
          </div>
        )}
        {tab === "Details" && (
          <div className="profile-body">
            {closed && (
              <p className="history-notice">
                Buyer information recorded when this opportunity closed.
              </p>
            )}
            <h3>Buyer</h3>
            <dl className="settings-list">
              <dt>Legal name</dt>
              <dd>{fullName(person) || effective.name}</dd>
              <dt>Driver’s license</dt>
              <dd>
                {[person.license_state, person.license_number]
                  .filter(Boolean)
                  .join(" · ") || "Not entered"}
              </dd>
              <dt>Residential address</dt>
              <dd>
                {[
                  person.address1,
                  person.address2,
                  person.city,
                  person.state,
                  person.zip,
                ]
                  .filter(Boolean)
                  .join(", ") || "Not entered"}
              </dd>
              <dt>Mailing address</dt>
              <dd>
                {person.mailing_different
                  ? [
                      person.mailing_address1,
                      person.mailing_address2,
                      person.mailing_city,
                      person.mailing_state,
                      person.mailing_zip,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "Same as residence"}
              </dd>
              <dt>Birthday</dt>
              <dd>{effective.birthday || "Not entered"}</dd>
            </dl>
            {co && (
              <>
                <h3>Co-buyer</h3>
                <dl className="settings-list">
                  <dt>Name</dt>
                  <dd>{fullName(co)}</dd>
                  <dt>Driver’s license</dt>
                  <dd>
                    {co.license_state} · {co.license_number}
                  </dd>
                  <dt>Address</dt>
                  <dd>
                    {[co.address1, co.address2, co.city, co.state, co.zip]
                      .filter(Boolean)
                      .join(", ")}
                  </dd>
                  <dt>Contact</dt>
                  <dd>{[co.phone, co.email].filter(Boolean).join(" · ")}</dd>
                </dl>
              </>
            )}
            <h3>Follow-up</h3>
            {visibleTasks(ws)
              .filter(
                (t) =>
                  t.customer_id === customer.id &&
                  (!o || (t.opportunity_id ?? null) === o.id) &&
                  isOpenTask(t),
              )
              .map((t) => (
                <div className="visit-history" key={t.id}>
                  <span>
                    {t.title} · {t.due_date}
                  </span>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      run({ type: "complete_task", id: t.id }, "Task completed")
                    }
                  >
                    Complete
                  </button>
                </div>
              ))}
            <h3>Visit history</h3>
            {ws.visits
              .filter(
                (v) =>
                  v.customer_id === customer.id &&
                  (!o || v.opportunity_id === o.id),
              )
              .map((v) => (
                <div className="visit-history" key={v.id}>
                  <span>
                    {new Date(v.arrived_at).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                    })}
                  </span>
                  <Badge
                    value={
                      v.outcome === "sold"
                        ? "sold"
                        : v.departed_at
                          ? "left"
                          : "here"
                    }
                  />
                </div>
              ))}
          </div>
        )}
        {tab === "Desking" && o && (
          <Desking
            dealership={ws.org.name}
            key={o.id + o.updated_at}
            customer={effective}
            opportunity={o}
            inventory={ws.inventory}
            quotes={ws.quotes}
            canViewProfit={manager}
            accounting={
              manager
                ? ws.sales?.find(
                    (s) => s.opportunity_id === o.id && s.status === "sold",
                  )?.accounting
                : undefined
            }
            busy={busy}
            onSave={(p) => run(p, "Desking version saved")}
            onPrint={(q) => onPrintQuote(effective, q)}
            onShare={(q, channel) =>
              setCompose({ channel, quote: q, opportunity_id: o.id })
            }
            onEdit={() => setModal("edit-opportunity")}
          />
        )}
        {tab === "Insurance" && (
          <div className="profile-body">
            <InsuranceForm
              key={o?.id ?? customer.id}
              customerId={customer.id}
              opportunityId={o?.id ?? null}
              demo={demo}
              vehicleVin={o?.vehicle_details?.vin}
              onRefresh={onRefresh}
              initial={
                closed ? o!.sale_snapshot?.insurance : customer.insurance
              }
              readOnly={closed}
              busy={busy}
              onSave={(insurance) =>
                run(
                  {
                    type: "save_insurance",
                    customer_id: customer.id,
                    insurance,
                  },
                  "Insurance saved",
                )
              }
            />
          </div>
        )}
      </Modal>
      {appointmentDialog && (
        <AppointmentDialog
          key={appointmentDialog === "new" ? "new" : appointmentDialog.id}
          ws={ws}
          customer={customer}
          opportunityId={o?.id ?? null}
          existing={appointmentDialog === "new" ? undefined : appointmentDialog}
          busy={busy}
          error={error}
          run={run}
          onClose={() => setAppointmentDialog(null)}
        />
      )}
      {modal === "task" && (
        <Modal
          title="Add follow-up task"
          subtitle={o ? o.title : "General customer task"}
          onClose={() => setModal(null)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              if (
                (
                  await run(
                    {
                      type: "create_task",
                      channel: String(data.get("channel") || "call") as "call",
                      ...(manager
                        ? {
                            assigned_to:
                              String(data.get("assigned_to")) || null,
                          }
                        : {}),
                      customer_id: customer.id,
                      opportunity_id: o?.id ?? null,
                      title: String(data.get("title")),
                      due_date: String(data.get("date")),
                      kind: "task",
                    },
                    "Task added",
                  )
                ).ok
              )
                setModal(null);
            }}
          >
            <label>
              Follow-up action
              <select name="channel" defaultValue="call">
                <option value="call">Call</option>
                <option value="sms">Text message</option>
                <option value="email">Email</option>
                <option value="task">General task</option>
              </select>
            </label>
            <label>
              Task
              <input name="title" required minLength={2} maxLength={250} />
            </label>
            <label>
              Due date
              <input name="date" type="date" required defaultValue={dayKey()} />
            </label>
            {manager && (
              <label>
                Assigned to
                <select name="assigned_to" defaultValue={assigned ?? ""}>
                  <option value="">Unassigned · manager queue</option>
                  {ws.staff
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              Add task
            </button>
          </form>
        </Modal>
      )}
      {compose && (
        <MessageComposer
          onRefresh={onRefresh}
          key={compose.draft?.id ?? (compose.quote?.id ?? "") + compose.channel}
          ws={ws}
          customer={customer}
          compose={compose}
          run={run}
          busy={busy}
          onClose={() => setCompose(null)}
        />
      )}
      {taskAction && (
        <TaskAction
          ws={ws}
          customer={customer}
          task={taskAction}
          run={run}
          busy={busy}
          onCompose={setCompose}
          onClose={() => setTaskAction(null)}
        />
      )}
      {recap && (
        <DealRecap
          ws={ws}
          saleId={recap}
          run={run}
          busy={busy}
          onClose={() => setRecap(null)}
        />
      )}
      {modal === "unwind" && o && (
        <Modal
          title="Unwind sold deal"
          subtitle={o.title}
          onClose={() => setModal(null)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                (
                  await run(
                    {
                      type: "unwind_sale",
                      opportunity_id: o.id,
                      reason: unwindReason,
                    },
                    "Deal unwound · vehicle returned to inventory",
                  )
                ).ok
              ) {
                setModal(null);
                setTab("Activity");
              }
            }}
          >
            <p>
              This reopens the opportunity, returns the sold vehicle to
              inventory, and cancels its remaining sold follow-ups. The original
              sale and paperwork stay in history. Its trade is returned unless
              it is already committed to another deal or sold wholesale.
            </p>
            <p>
              Original commissions remain recorded; paid amounts appear as
              recovery balances. Confirm that the vehicle and trade can be
              returned before proceeding.
            </p>
            <label>
              Reason
              <textarea
                required
                minLength={3}
                maxLength={2000}
                value={unwindReason}
                onChange={(e) => setUnwindReason(e.target.value)}
                placeholder="Financing fell through, marked sold by mistake…"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              Confirm unwind
            </button>
          </form>
        </Modal>
      )}
      {modal === "customer" && (
        <Modal
          title="Edit customer"
          subtitle="Contact details, identification, and co-buyer."
          wide
          onClose={() => setModal(null)}
        >
          <CustomerForm
            demo={demo}
            onComplete={() => setModal(null)}
            ws={ws}
            existing={customer}
            busy={busy}
            error={error}
            submit={async (data) => {
              return await run(
                {
                  type: "update_customer",
                  id: customer.id,
                  customer: data,
                },
                "Customer updated",
              );
            }}
          />
        </Modal>
      )}
      {modal === "merge" && manager && (
        <MergeCustomers
          ws={ws}
          customer={customer}
          busy={busy}
          error={error}
          run={run}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "co-buyer" && o && !closed && (
        <CoBuyerDialog
          ws={ws}
          opportunity={o}
          busy={busy}
          error={error}
          run={run}
          onClose={() => setModal(null)}
        />
      )}
      {(modal === "new-opportunity" ||
        modal === "edit-opportunity" ||
        ((modal === "edit-vehicle" || modal === "edit-trade") &&
          o &&
          !closed)) && (
        <Modal
          title={
            modal === "new-opportunity"
              ? "New opportunity"
              : modal === "edit-vehicle"
                ? "Vehicle of interest"
                : modal === "edit-trade"
                  ? "Trade-in details"
                  : "Edit opportunity"
          }
          subtitle={
            modal === "edit-vehicle" || modal === "edit-trade"
              ? o?.title
              : "Vehicle, trade, and stage for this purchase."
          }
          wide={modal === "new-opportunity" || modal === "edit-opportunity"}
          onClose={() => setModal(null)}
        >
          <OpportunityForm
            key={`${modal}:${o?.id ?? "new"}`}
            existing={modal !== "new-opportunity" ? (o ?? null) : null}
            section={
              modal === "edit-vehicle"
                ? "vehicle"
                : modal === "edit-trade"
                  ? "trade"
                  : "all"
            }
            staff={ws.staff}
            manager={manager}
            defaultAssignee={
              manager ? (customer.assigned_to ?? me ?? null) : (me ?? null)
            }
            inventory={ws.inventory}
            demo={demo}
            busy={busy}
            error={error}
            submit={async (data) => {
              const result = await run(
                modal !== "new-opportunity" && o
                  ? { type: "update_opportunity", id: o.id, opportunity: data }
                  : {
                      type: "create_opportunity",
                      customer_id: customer.id,
                      opportunity: data,
                    },
                modal === "edit-vehicle"
                  ? "Vehicle of interest updated"
                  : modal === "edit-trade"
                    ? "Trade-in updated"
                    : "Opportunity saved",
              );
              if (result.ok) {
                if (result.id) setSelected(result.id);
                if (modal === "new-opportunity" || modal === "edit-opportunity")
                  setTab("Desking");
                setModal(null);
              }
            }}
          />
        </Modal>
      )}
      {(modal === "sold" || modal === "lost") && o && (
        <Modal
          title={
            modal === "sold"
              ? "Close this opportunity as sold"
              : "Close this opportunity as lost"
          }
          subtitle={o.title}
          onClose={() => setModal(null)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                (
                  await run(
                    {
                      type: "close_opportunity",
                      id: o.id,
                      outcome: modal === "sold" ? "sold" : "lost",
                      reason,
                    },
                    modal === "sold"
                      ? "Opportunity sold. Follow-up is planned."
                      : "Opportunity closed as lost.",
                  )
                ).ok
              ) {
                setModal(null);
                setReason("");
              }
            }}
          >
            <p>
              This preserves this opportunity’s vehicle, trade, buyer
              information, insurance, and latest matching saved proposal.
            </p>
            <p className="fine-print">
              {modal === "sold"
                ? "The linked stock vehicle will be marked sold. Sale follow-ups and a purchase anniversary will be created. End the showroom visit when the customer leaves."
                : "Other opportunities for this customer stay open. You can start another opportunity at any time."}
            </p>
            {modal === "lost" && (
              <label>
                Reason / notes
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                />
              </label>
            )}
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              {modal === "sold" ? "Confirm sale" : "Confirm lost opportunity"}
            </button>
          </form>
        </Modal>
      )}
      {modal === "pack-choice" && o && (
        <Modal
          title="Choose a sold pack"
          subtitle="Both options include the forms for the vehicle being sold."
          onClose={() => setModal(null)}
        >
          <div className="sold-pack-choices">
            <button
              onClick={() => {
                setPackVariant("without-trade");
                setModal("pack");
              }}
            >
              <strong>Sold without trade</strong>
              <span>12 forms · No trade payoff sheet.</span>
            </button>
            <button
              onClick={() => {
                setPackVariant("with-trade");
                setModal("pack");
              }}
            >
              <strong>Sold with trade</strong>
              <span>
                16 forms · Includes payoff and a separate MVR-180, MVR-181, and
                MVR-63 for the trade-in.
              </span>
            </button>
          </div>
        </Modal>
      )}
      {(modal === "pack" || modal === "mvr2") && o && (
        <SoldPack
          workspace={ws}
          customer={customer}
          opportunity={o}
          mode={modal === "mvr2" ? "mvr2" : "pack"}
          variant={packVariant}
          demo={demo}
          busy={busy}
          run={run}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
