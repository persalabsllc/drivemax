"use client";
import { useState } from "react";
import { blankInsurance, type Insurance } from "../lib/people";
export function InsuranceForm({
  initial,
  busy,
  onSave,
  readOnly = false,
}: {
  initial: Insurance | null | undefined;
  busy: boolean;
  onSave: (v: Insurance) => Promise<unknown>;
  readOnly?: boolean;
}) {
  const [v, setV] = useState<Insurance>({ ...blankInsurance, ...initial });
  const fields: [keyof Insurance, string, string][] = [
    ["company", "Insurance company", "text"],
    ["policy_number", "Policy number", "text"],
    ["agent", "Agent name", "text"],
    ["agent_phone", "Agent phone", "tel"],
    ["agent_email", "Agent email", "email"],
    ["agent_address", "Agency address", "text"],
    ["effective_from", "Effective date", "date"],
    ["effective_to", "Expiration date", "date"],
    ["collision_deductible", "Collision deductible", "number"],
    ["comprehensive_deductible", "Comprehensive deductible", "number"],
  ];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(v);
      }}
      className="insurance-form"
    >
      <h3>
        {readOnly ? "Insurance recorded at closing" : "Automobile insurance"}
      </h3>
      <p className="muted-copy">
        {readOnly
          ? "This policy belongs to the completed opportunity. Print-preview corrections can be saved with its paperwork."
          : "Policy information pre-fills the sold pack. Completed opportunities retain the policy recorded at closing."}
      </p>
      <div className="form-grid">
        {fields.map(([k, l, t]) => (
          <label key={k}>
            {l}
            <input
              type={t}
              value={v[k] ?? ""}
              readOnly={readOnly}
              min={t === "number" ? 0 : undefined}
              max={t === "number" ? 100000 : undefined}
              step={t === "number" ? 0.01 : undefined}
              maxLength={250}
              onChange={(e) =>
                setV({
                  ...v,
                  [k]:
                    t === "number"
                      ? e.target.value === ""
                        ? null
                        : Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
      {!readOnly && (
        <button className="btn primary" disabled={busy}>
          Save insurance
        </button>
      )}
    </form>
  );
}
