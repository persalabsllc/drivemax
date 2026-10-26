"use client";
import { useState } from "react";
import { type Customer, type Command, commandSchema } from "../lib/model";
import { blankPerson, fullName, personFromCustomer } from "../lib/people";
import { PersonFields } from "./PersonFields";
export function CustomerForm({
  existing,
  busy,
  error,
  submit,
}: {
  existing: Customer | null;
  busy: boolean;
  error: string;
  submit: (
    c: Extract<Command, { type: "create_customer" }>["customer"],
  ) => Promise<void>;
}) {
  const [person, setPerson] = useState(() =>
      existing ? personFromCustomer(existing) : { ...blankPerson },
    ),
    [co, setCo] = useState(() => existing?.co_buyer ?? { ...blankPerson }),
    [hasCo, setHasCo] = useState(!!existing?.co_buyer),
    [createOpp, setCreateOpp] = useState(true),
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
        const parsed = commandSchema.safeParse({
          type: "create_customer",
          customer: data,
        });
        if (!parsed.success) {
          setLocalError(parsed.error.issues[0].message);
          return;
        }
        setLocalError("");
        await submit(data);
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={createOpp}
            onChange={(e) => setCreateOpp(e.target.checked)}
          />
          Start an opportunity for this customer
        </label>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="modal-footer">
        <span>Vehicle and trade details are saved on opportunities.</span>
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save customer" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
