"use client";
import { useState } from "react";
import {
  CalendarDays,
  Clock,
  Plus,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Command,
  canManage,
  myStaffId,
  dayKey,
  addDays,
} from "../lib/model";
import {
  appointmentKinds,
  appointmentStatuses,
  appointmentSchema,
  appointmentDetailsSchema,
  appointmentLocalParts,
  appointmentInstant,
  appointmentTime,
  appointmentDateTime,
  appointmentEnd,
  appointmentsForRange,
  overlappingAppointments,
  appointmentTransitions,
  isOpenAppointment,
  canEditAppointment,
  type Appointment,
  type AppointmentKind,
} from "../lib/appointments";
import { Modal, SectionTitle, Empty } from "./ui";

export type AppointmentFormValue = {
  date: string;
  time: string;
  kind: AppointmentKind;
  duration_minutes: number;
  assigned_to: string;
  description: string;
};
export function appointmentFormValue(
  ws: Workspace,
  existing?: Appointment,
  date?: string,
  assignedTo?: string | null,
): AppointmentFormValue {
  const next = new Date(
    Math.ceil((Date.now() + 30 * 60000) / (30 * 60000)) * 30 * 60000,
  );
  const local = appointmentLocalParts(existing?.starts_at ?? next);
  return {
    date: date ?? local.date,
    time: date && date !== local.date ? "10:00" : local.time,
    kind: existing?.kind ?? "test_drive",
    duration_minutes: existing?.duration_minutes ?? 60,
    assigned_to:
      existing?.assigned_to ??
      (canManage(ws.member.role) &&
      ws.staff.some((s) => s.id === assignedTo && s.active)
        ? assignedTo!
        : (myStaffId(ws) ?? "")),
    description: existing?.description ?? "",
  };
}
export function appointmentFormDetails(value: AppointmentFormValue) {
  return appointmentDetailsSchema.parse({
    ...value,
    starts_at: appointmentInstant(value.date, value.time),
  });
}
export function AppointmentFields({
  ws,
  value,
  onChange,
  readOnly = false,
  timeReadOnly = false,
}: {
  ws: Workspace;
  value: AppointmentFormValue;
  onChange: (value: AppointmentFormValue) => void;
  readOnly?: boolean;
  timeReadOnly?: boolean;
}) {
  const set = (field: keyof AppointmentFormValue, data: string | number) =>
    onChange({ ...value, [field]: data });
  return (
    <>
      <div className="appt-fields">
        <label>
          Appointment type
          <select
            value={value.kind}
            disabled={readOnly}
            onChange={(e) => set("kind", e.target.value)}
          >
            {Object.entries(appointmentKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned salesperson
          <select
            required
            value={value.assigned_to}
            disabled={readOnly || !canManage(ws.member.role)}
            onChange={(e) => set("assigned_to", e.target.value)}
          >
            <option value="">Select a salesperson</option>
            {ws.staff
              .filter((s) => s.active || s.id === value.assigned_to)
              .map((s) => (
                <option key={s.id} value={s.id} disabled={!s.active}>
                  {s.name}
                  {s.active ? "" : " (inactive)"}
                </option>
              ))}
          </select>
        </label>
        <label>
          Appointment date
          <input
            type="date"
            required
            min="2000-01-01"
            max="2100-12-31"
            value={value.date}
            disabled={readOnly || timeReadOnly}
            onChange={(e) => set("date", e.target.value)}
          />
        </label>
        <label>
          Appointment time (Eastern)
          <input
            type="time"
            required
            value={value.time}
            disabled={readOnly || timeReadOnly}
            onChange={(e) => set("time", e.target.value)}
          />
        </label>
        <label>
          Duration
          <select
            value={value.duration_minutes}
            disabled={readOnly || timeReadOnly}
            onChange={(e) => set("duration_minutes", Number(e.target.value))}
          >
            {Array.from({ length: 16 }, (_, i) => (i + 1) * 15).map((n) => (
              <option key={n} value={n}>
                {n < 60
                  ? `${n} minutes`
                  : `${Math.floor(n / 60)} hr${n % 60 ? ` ${n % 60} min` : ""}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Appointment description
        <textarea
          aria-label="Appointment description"
          rows={3}
          maxLength={1000}
          value={value.description}
          disabled={readOnly}
          placeholder="For example: Returning with spouse to test drive the Accord."
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <p className="ops-help">
        All appointment times are Eastern Time. Include anything the salesperson
        should know before the visit.
      </p>
    </>
  );
}

export function AppointmentConflictNotice({
  ws,
  value,
  id,
}: {
  ws: Workspace;
  value: AppointmentFormValue;
  id: string;
}) {
  let conflicts: Appointment[] = [];
  try {
    conflicts = overlappingAppointments(
      ws.appointments ?? [],
      appointmentFormDetails(value),
      id,
    );
  } catch {
    /* Incomplete form values are validated on submission. */
  }
  if (!conflicts.length) return null;
  return (
    <div className="appt-conflict" role="status">
      <strong>This salesperson already has an overlapping appointment.</strong>
      {conflicts.slice(0, 3).map((a) => (
        <div key={a.id}>
          {appointmentTime(a.starts_at)} ·{" "}
          {ws.customers.find((c) => c.id === a.customer_id)?.name} ·{" "}
          {appointmentKinds[a.kind]}
        </div>
      ))}
      <span>You can still save if the overlap is intentional.</span>
    </div>
  );
}

export function AppointmentDialog({
  ws,
  existing,
  customer,
  opportunityId,
  initialDate,
  busy,
  error,
  run,
  onClose,
  onCustomer,
}: {
  ws: Workspace;
  existing?: Appointment;
  customer?: Customer;
  opportunityId?: string | null;
  initialDate?: string;
  busy: boolean;
  error: string;
  run: (p: Command, message?: string) => Promise<{ ok: boolean; id?: string }>;
  onClose: () => void;
  onCustomer?: (customer: Customer, opportunityId: string | null) => void;
}) {
  const [id] = useState(() => existing?.id ?? crypto.randomUUID()),
    [revision] = useState(existing?.revision ?? 0),
    [customerId, setCustomerId] = useState(
      existing?.customer_id ?? customer?.id ?? "",
    ),
    [oppId, setOppId] = useState(
      existing?.opportunity_id ?? opportunityId ?? "",
    ),
    [search, setSearch] = useState(""),
    [localError, setLocalError] = useState(""),
    [value, setValue] = useState(() =>
      appointmentFormValue(
        ws,
        existing,
        initialDate,
        ws.opportunities.find((o) => o.id === opportunityId)?.assigned_to ??
          customer?.assigned_to,
      ),
    );
  const readOnly =
    !!existing &&
    (!canEditAppointment(ws, existing) || !isOpenAppointment(existing));
  const chosenCustomer = ws.customers.find((c) => c.id === customerId);
  const matches = ws.customers.filter(
    (c) =>
      `${c.name} ${c.phone} ${c.email}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) ||
      (search.replace(/\D/g, "").length >= 3 &&
        c.phone.replace(/\D/g, "").includes(search.replace(/\D/g, ""))),
  );
  const customerOptions = chosenCustomer
    ? [chosenCustomer, ...matches.filter((c) => c.id !== customerId)]
    : matches;
  const options = ws.opportunities.filter((o) => o.customer_id === customerId);
  const original = existing ? appointmentFormValue(ws, existing) : null;
  const hasChanges =
    !!original &&
    (oppId !== (existing?.opportunity_id ?? "") ||
      Object.keys(original).some(
        (key) =>
          original[key as keyof AppointmentFormValue] !==
          value[key as keyof AppointmentFormValue],
      ));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setLocalError("");
    try {
      if (!customerId) throw Error("Select a customer for this appointment.");
      const appointment = appointmentSchema.parse({
        ...appointmentFormDetails(value),
        customer_id: customerId,
        opportunity_id: oppId || null,
      });
      if (
        (
          await run(
            { type: "save_appointment", id, revision, appointment },
            existing ? "Appointment updated" : "Appointment scheduled",
          )
        ).ok
      )
        onClose();
    } catch (e) {
      setLocalError(
        e instanceof Error
          ? "issues" in e
            ? "Check the appointment date, time, and salesperson."
            : e.message
          : "Check the appointment details.",
      );
    }
  }
  return (
    <Modal
      title={existing ? "Appointment details" : "Schedule appointment"}
      subtitle={chosenCustomer?.name ?? "Plan the next visit."}
      onClose={onClose}
    >
      <form className="modal-form appt-editor" onSubmit={save}>
        {existing && (
          <div className="appt-detail-heading">
            <span className={`appt-status ${existing.status}`}>
              {appointmentStatuses[existing.status]}
            </span>
            {onCustomer && chosenCustomer && (
              <button
                type="button"
                className="text-btn"
                onClick={() =>
                  onCustomer(chosenCustomer, existing.opportunity_id)
                }
              >
                Open customer profile <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        )}
        {!customer && !existing && (
          <div className="appt-customer-picker">
            <label>
              Find customer
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, phone, or email"
              />
            </label>
            <label>
              Customer
              <select
                required
                value={customerId}
                onChange={(e) => {
                  const c = ws.customers.find((c) => c.id === e.target.value),
                    o = ws.opportunities.find(
                      (o) =>
                        o.customer_id === c?.id &&
                        !["sold", "lost"].includes(o.status),
                    );
                  setCustomerId(e.target.value);
                  setOppId(o?.id ?? "");
                  if (canManage(ws.member.role))
                    setValue({
                      ...value,
                      assigned_to:
                        o?.assigned_to ?? c?.assigned_to ?? myStaffId(ws) ?? "",
                    });
                }}
              >
                <option value="">Select a customer</option>
                {customerOptions.slice(0, 100).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {matches.length > 100 && (
              <p className="ops-help">
                Showing the first 100 matches. Type a name to narrow the list.
              </p>
            )}
          </div>
        )}
        {customerId && (
          <label>
            Related opportunity
            <select
              value={oppId}
              disabled={readOnly}
              onChange={(e) => setOppId(e.target.value)}
            >
              <option value="">General customer visit</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {o.status}
                </option>
              ))}
            </select>
          </label>
        )}
        <AppointmentFields
          ws={ws}
          value={value}
          onChange={setValue}
          readOnly={readOnly}
          timeReadOnly={existing?.status === "arrived"}
        />
        {!readOnly && (
          <AppointmentConflictNotice ws={ws} value={value} id={id} />
        )}
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        {readOnly ? (
          <p className="ops-help">
            {existing && isOpenAppointment(existing)
              ? "The assigned salesperson or a manager can update this appointment."
              : "This appointment is kept in the customer’s history. Use Schedule appointment to arrange another visit."}
          </p>
        ) : (
          <>
            <div className="modal-footer">
              <span>
                {existing
                  ? "Changes are recorded in customer history."
                  : "Enabled email workflows send confirmations, changes and reminders. Text delivery is inactive."}
              </span>
              <button className="btn primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : existing
                    ? "Save changes"
                    : "Schedule appointment"}
              </button>
            </div>
            {existing && (
              <div className="appt-outcomes">
                <h3>Update appointment status</h3>
                <div className="ops-actions">
                  {appointmentTransitions[existing.status].map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={`btn small ${status === "arrived" ? "success" : ""}`}
                      disabled={busy || hasChanges}
                      onClick={async () => {
                        setLocalError("");
                        if (
                          (
                            await run(
                              {
                                type: "set_appointment_status",
                                id,
                                revision,
                                status,
                              },
                              `Appointment ${appointmentStatuses[status].toLowerCase()}`,
                            )
                          ).ok
                        )
                          onClose();
                      }}
                    >
                      {status === "canceled"
                        ? "Cancel appointment"
                        : status === "no_show"
                          ? "Mark no-show"
                          : `Mark ${appointmentStatuses[status].toLowerCase()}`}
                    </button>
                  ))}
                </div>
                <p className="ops-help">
                  Marking arrived also checks the customer into the showroom.
                  Use End visit on their profile when they leave. Save any
                  edited details before changing status.
                </p>
              </div>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

export function AppointmentRow({
  appointment: a,
  ws,
  onClick,
  compact = false,
}: {
  appointment: Appointment;
  ws: Workspace;
  onClick: (a: Appointment) => void;
  compact?: boolean;
}) {
  const date = appointmentLocalParts(a.starts_at).date,
    today = dayKey();
  const overdue =
    isOpenAppointment(a) &&
    a.status !== "arrived" &&
    Date.parse(appointmentEnd(a)) < Date.now();
  return (
    <button
      className={`appt-row ${overdue ? "needs-outcome" : ""}`}
      onClick={() => onClick(a)}
    >
      <span className="appt-when">
        <span>
          {date === today
            ? "Today"
            : date === addDays(today, 1)
              ? "Tomorrow"
              : new Date(a.starts_at).toLocaleDateString("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                  year:
                    date.slice(0, 4) === today.slice(0, 4)
                      ? undefined
                      : "numeric",
                })}
        </span>
        <strong>{appointmentTime(a.starts_at)}</strong>
        <small>{a.duration_minutes} min · Eastern</small>
      </span>
      <span className="appt-person">
        <strong>
          {compact
            ? appointmentKinds[a.kind]
            : (ws.customers.find((c) => c.id === a.customer_id)?.name ??
              "Customer")}
        </strong>
        {!compact && <span>{appointmentKinds[a.kind]}</span>}
        <small>{a.description || "No additional notes."}</small>
      </span>
      <span className="appt-owner">
        <span>
          <UserRound size={13} />
          {ws.staff.find((s) => s.id === a.assigned_to)?.name ?? "Salesperson"}
        </span>
        <span className={`appt-status ${a.status}`}>
          {appointmentStatuses[a.status]}
        </span>
        {overdue && <small>Needs an outcome</small>}
      </span>
      <ArrowUpRight size={16} className="appt-row-arrow" />
    </button>
  );
}

export function AppointmentOverview({
  ws,
  onSchedule,
  onOpen,
}: {
  ws: Workspace;
  onSchedule: () => void;
  onOpen: (a: Appointment) => void;
}) {
  const [period, setPeriod] = useState("upcoming"),
    [owner, setOwner] = useState("all"),
    [showAll, setShowAll] = useState(false);
  const today = dayKey(),
    appointments = ws.appointments ?? [];
  const pending = appointments.filter(
    (a) =>
      isOpenAppointment(a) &&
      appointmentLocalParts(a.starts_at).date < today &&
      (owner === "all" || a.assigned_to === owner),
  );
  const rows =
    period === "today"
      ? appointments
          .filter(
            (a) =>
              appointmentLocalParts(a.starts_at).date === today &&
              (owner === "all" || a.assigned_to === owner),
          )
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      : period === "past"
        ? pending.sort(
            (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
          )
        : appointmentsForRange(
            appointments,
            today,
            period === "week" ? addDays(today, 6) : "9999-12-31",
            owner,
          );
  return (
    <section className="panel appt-overview" aria-label="Appointment schedule">
      <SectionTitle
        title="Appointments"
        subtitle="Visits and deliveries. All times Eastern."
        action={
          <button className="btn primary small" onClick={onSchedule}>
            <Plus size={15} />
            Schedule appointment
          </button>
        }
      />
      <div className="appt-controls">
        <div className="segmented">
          {[
            ["upcoming", "Upcoming"],
            ["today", "Today"],
            ["week", "Next 7 days"],
            [
              "past",
              `Past unresolved${pending.length ? ` (${pending.length})` : ""}`,
            ],
          ].map(([key, label]) => (
            <button
              key={key}
              className={period === key ? "chosen" : ""}
              aria-pressed={period === key}
              onClick={() => {
                setPeriod(key);
                setShowAll(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Salesperson
          <select
            aria-label="Appointment salesperson filter"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setShowAll(false);
            }}
          >
            <option value="all">Entire team</option>
            {ws.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length ? (
        <>
          <div className="appt-list">
            {rows.slice(0, showAll ? rows.length : 6).map((a) => (
              <AppointmentRow
                key={a.id}
                appointment={a}
                ws={ws}
                onClick={onOpen}
              />
            ))}
          </div>
          {rows.length > 6 && (
            <button
              className="text-btn appt-show-more"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show fewer" : `Show all ${rows.length} appointments`}
            </button>
          )}
        </>
      ) : (
        <Empty
          title={
            period === "past"
              ? "No unresolved past appointments."
              : "Ready for the next visit."
          }
          body={
            period === "past"
              ? "Past appointments with a recorded outcome stay in customer history."
              : "Schedule a test drive, a return visit, delivery, service, or another appointment."
          }
        />
      )}
    </section>
  );
}

export function CustomerAppointments({
  ws,
  customer,
  onSchedule,
  onOpen,
}: {
  ws: Workspace;
  customer: Customer;
  onSchedule: () => void;
  onOpen: (a: Appointment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const appointments = (ws.appointments ?? []).filter(
    (a) => a.customer_id === customer.id,
  );
  const open = appointments
    .filter(isOpenAppointment)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const history = appointments
    .filter((a) => !isOpenAppointment(a))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return (
    <section className="appt-customer" aria-label="Customer appointments">
      <div className="appt-customer-head">
        <h3>
          <CalendarDays size={17} />
          Appointments
          {open.length > 0 && <span className="ops-count">{open.length}</span>}
        </h3>
        <button
          className="btn small"
          onClick={onSchedule}
          aria-label="Schedule appointment"
          title="Schedule appointment"
        >
          <Plus size={14} />
          <span className="appt-schedule-label">Schedule</span>
        </button>
      </div>
      {open.length ? (
        <div className="appt-customer-list">
          {(showAllOpen ? open : open.slice(0, 1)).map((a) => (
            <AppointmentRow
              key={a.id}
              appointment={a}
              ws={ws}
              onClick={onOpen}
              compact
            />
          ))}
        </div>
      ) : (
        <p className="ops-help">No open appointments.</p>
      )}
      {open.length > 1 && (
        <button
          className="text-btn appt-show-more"
          aria-expanded={showAllOpen}
          onClick={() => setShowAllOpen(!showAllOpen)}
        >
          {showAllOpen
            ? "Show fewer appointments"
            : `Show all ${open.length} open appointments`}
        </button>
      )}
      {history.length > 0 && (
        <>
          <button
            className="text-btn appt-show-more"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Clock size={13} />
            {expanded ? "Hide" : "Show"} appointment history ({history.length})
          </button>
          {expanded && (
            <div className="appt-customer-list">
              {history.map((a) => (
                <AppointmentRow
                  key={a.id}
                  appointment={a}
                  ws={ws}
                  onClick={onOpen}
                  compact
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
