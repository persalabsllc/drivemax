"use client";
import { useState } from "react";
import {
  type Customer,
  type Command,
  type Workspace,
  commandSchema,
} from "../lib/model";
import { type NewCustomerAppointment } from "../lib/appointments";
import {
  AppointmentFields,
  AppointmentConflictNotice,
  appointmentFormValue,
  appointmentFormDetails,
} from "./Appointments";
import { blankPerson, fullName, personFromCustomer } from "../lib/people";
import { PersonFields } from "./PersonFields";
export function CustomerForm({
  existing,
  ws,
  busy,
  error,
  submit,
}: {
  existing: Customer | null;
  ws: Workspace;
  busy: boolean;
  error: string;
  submit: (
    c: Extract<Command, { type: "create_customer" }>["customer"],
    appointment?: NewCustomerAppointment,
  ) => Promise<void>;
}) {
  const [person, setPerson] = useState(() =>
      existing ? personFromCustomer(existing) : { ...blankPerson },
    ),
    [co, setCo] = useState(() => existing?.co_buyer ?? { ...blankPerson }),
    [hasCo, setHasCo] = useState(!!existing?.co_buyer),
    [createOpp, setCreateOpp] = useState(true),
    [schedule, setSchedule] = useState(false),
    [appointmentId] = useState(() => crypto.randomUUID()),
    [appointment, setAppointment] = useState(() => appointmentFormValue(ws)),
    [localError, setLocalError] = useState("");
  return (
    <form
      className="modal-form customer-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const data = {
          name: fullName(person),
          phone: person.phone,
          email: person.email,
          person,
          co_buyer: hasCo ? co : null,
          birthday: String(f.get("birthday")) || null,
          source: String(f.get("source")),
          status: existing?.status ?? "new",
          vehicle_interest: existing?.vehicle_interest ?? "",
          trade_vehicle: existing?.trade_vehicle ?? "",
          initial_opportunity: createOpp,
        };
        let scheduled: NewCustomerAppointment | undefined;
        if (schedule && !existing) {
          try {
            scheduled = {
              ...appointmentFormDetails(appointment),
              id: appointmentId,
            };
          } catch (e) {
            setLocalError(
              e instanceof Error && !("issues" in e)
                ? e.message
                : "Check the appointment date, time, and salesperson.",
            );
            return;
          }
        }
        const parsed = commandSchema.safeParse({
          type: "create_customer",
          customer: data,
          appointment: scheduled,
        });
        if (!parsed.success) {
          setLocalError(parsed.error.issues[0].message);
          return;
        }
        setLocalError("");
        await submit(data, scheduled);
      }}
    >
      <h3>Buyer information</h3>
      <p className="fine-print">
        Contact information stays with the customer across every opportunity.
      </p>
      <PersonFields value={person} onChange={setPerson} prefix="Buyer" />
      <div className="form-grid">
        <label>
          Birthday
          <input
            name="birthday"
            type="date"
            defaultValue={existing?.birthday ?? ""}
          />
        </label>
        <label>
          Lead source
          <select name="source" defaultValue={existing?.source ?? "Walk-in"}>
            {[
              "Walk-in",
              "Website",
              "Facebook",
              "Phone",
              "Referral",
              "Repeat customer",
              "Other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <section className="editor-section">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hasCo}
            onChange={(e) => setHasCo(e.target.checked)}
          />
          Add a co-buyer
        </label>
        {hasCo && (
          <>
            <h3>Co-buyer information</h3>
            <p className="fine-print">
              Enter their name, driver’s license, and residential address.
              Completed deals keep the co-buyer recorded at sale.
            </p>
            <PersonFields
              value={co}
              onChange={setCo}
              prefix="Co-buyer"
              complete
            />
          </>
        )}
      </section>
      {!existing && (
        <section className="editor-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={createOpp}
              onChange={(e) => setCreateOpp(e.target.checked)}
            />
            Start an opportunity for this customer
          </label>
          <label className="checkbox-label appt-create-toggle">
            <input
              type="checkbox"
              checked={schedule}
              onChange={(e) => setSchedule(e.target.checked)}
            />
            Schedule an appointment
          </label>
          {schedule && (
            <>
              <AppointmentFields
                ws={ws}
                value={appointment}
                onChange={setAppointment}
              />
              <AppointmentConflictNotice
                ws={ws}
                value={appointment}
                id={appointmentId}
              />
            </>
          )}
        </section>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="modal-footer">
        <span>Vehicle and trade details are saved on opportunities.</span>
        <button className="btn primary" disabled={busy}>
          {busy
            ? "Saving…"
            : existing
              ? "Save customer"
              : schedule
                ? "Create customer & appointment"
                : "Create customer"}
        </button>
      </div>
    </form>
  );
}
