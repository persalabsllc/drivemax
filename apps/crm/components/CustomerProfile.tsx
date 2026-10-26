"use client";
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
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Command,
  type Opportunity,
  type Quote,
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
import { OpportunityForm } from "./OpportunityForm";
import { InsuranceForm } from "./InsuranceForm";
import { Desking } from "./Desking";
import dynamic from "next/dynamic";
const SoldPack = dynamic(() => import("./SoldPack").then((m) => m.SoldPack), {
  ssr: false,
});
type Tab = "Activity" | "Details" | "Desking" | "Insurance";
export function CustomerProfile({
  ws,
  customer,
  demo,
  busy,
  error,
  run,
  onClose,
  onPrintQuote,
  initialTab = "Activity",
  initialOpportunityId,
}: {
  ws: Workspace;
  customer: Customer;
  demo: boolean;
  busy: boolean;
  error: string;
  run: (p: Command, message?: string) => Promise<{ ok: boolean; id?: string }>;
  onClose: () => void;
  onPrintQuote: (c: Customer, q: Quote) => void;
  initialTab?: Tab;
  initialOpportunityId?: string | null;
}) {
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
      | "customer"
      | "new-opportunity"
      | "edit-opportunity"
      | "sold"
      | "lost"
      | "pack"
      | "pack-choice"
      | "mvr2"
      | "task"
      | null
    >(null),
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
    activities = ws.activities
      .filter(
        (a) =>
          a.customer_id === customer.id &&
          (a.opportunity_id ?? null) === (o?.id ?? null),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const manager = canManage(ws.member.role),
    me = myStaffId(ws),
    assigned = o ? o.assigned_to : customer.assigned_to;
  const person = personFromCustomer(effective),
    co = effective.co_buyer;
  function choose(id: string | null) {
    setSelected(id);
    setNote("");
    if (!id && tab === "Desking") setTab("Activity");
  }
  return (
    <>
      <Modal
        title="Customer profile"
        subtitle="One relationship. Every opportunity."
        wide
        onClose={onClose}
      >
        <div className="profile-top">
          <Avatar name={customer.name} size="large" />
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
          <button className="btn small" onClick={() => setModal("customer")}>
            Edit customer
          </button>
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
        <section className="opportunity-section">
          <div className="desk-section-head">
            <div>
              <span className="eyebrow">OPPORTUNITIES</span>
              <h3>Every purchase has a story.</h3>
            </div>
            <button
              className="btn primary small"
              onClick={() => setModal("new-opportunity")}
            >
              <Plus size={15} />
              New opportunity
            </button>
          </div>
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
        </section>
        {o && (
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
            <div>
              <small>VEHICLE OF INTEREST</small>
              <strong>
                <Car size={16} />
                {o.vehicle_interest || "Not selected yet"}
              </strong>
            </div>
            <div>
              <small>TRADE-IN</small>
              <strong>
                <ArrowLeftRight size={16} />
                {o.trade_vehicle || "No trade-in"}
              </strong>
            </div>
          </div>
        )}
        <div className="profile-tabs">
          {(["Activity", "Details", "Desking", "Insurance"] as Tab[])
            .filter((t) => !!o || t !== "Desking")
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
            <h3 className="timeline-title">
              {o ? "Opportunity history" : "Customer history"}
            </h3>
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
                      <strong>
                        {a.kind === "note"
                          ? "Note"
                          : a.kind === "call"
                            ? "Phone call"
                            : a.kind === "email"
                              ? "Email log"
                              : a.kind === "sms"
                                ? "Text message log"
                                : "Update"}
                      </strong>
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
                    <small>{a.created_by}</small>
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
            key={o.id + o.updated_at}
            customer={effective}
            opportunity={o}
            inventory={ws.inventory}
            quotes={ws.quotes}
            busy={busy}
            onSave={(p) => run(p, "Desking version saved")}
            onPrint={(q) => onPrintQuote(effective, q)}
            onEdit={() => setModal("edit-opportunity")}
          />
        )}
        {tab === "Insurance" && (
          <div className="profile-body">
            <InsuranceForm
              key={o?.id ?? customer.id}
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
      {modal === "customer" && (
        <Modal
          title="Edit customer"
          subtitle="Contact details, identification, and co-buyer."
          wide
          onClose={() => setModal(null)}
        >
          <CustomerForm
            existing={customer}
            busy={busy}
            error={error}
            submit={async (data) => {
              if (
                (
                  await run(
                    {
                      type: "update_customer",
                      id: customer.id,
                      customer: data,
                    },
                    "Customer updated",
                  )
                ).ok
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {(modal === "new-opportunity" || modal === "edit-opportunity") && (
        <Modal
          title={
            modal === "new-opportunity" ? "New opportunity" : "Edit opportunity"
          }
          subtitle="Vehicle, trade, and stage for this purchase."
          wide
          onClose={() => setModal(null)}
        >
          <OpportunityForm
            existing={modal === "edit-opportunity" ? (o ?? null) : null}
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
                modal === "edit-opportunity" && o
                  ? { type: "update_opportunity", id: o.id, opportunity: data }
                  : {
                      type: "create_opportunity",
                      customer_id: customer.id,
                      opportunity: data,
                    },
                "Opportunity saved",
              );
              if (result.ok) {
                if (result.id) setSelected(result.id);
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
