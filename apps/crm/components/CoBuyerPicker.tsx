"use client";
import { useId, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";
import type { Customer, Opportunity, Workspace, Command } from "../lib/model";
import {
  coBuyerLinkSchema,
  coBuyerSelection,
  type CoBuyerLink,
} from "../lib/customer-links";
import { blankPerson } from "../lib/people";
import { PersonFields } from "./PersonFields";
import { Modal } from "./ui";

export function CoBuyerPicker({
  customers,
  buyerId,
  value,
  onChange,
  disabled = false,
}: {
  customers: Customer[];
  buyerId?: string;
  value: CoBuyerLink;
  onChange: (value: CoBuyerLink) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const selected =
    value.mode === "existing"
      ? customers.find((c) => c.id === value.customer_id)
      : null;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = customers
    .filter(
      (c) =>
        c.id !== buyerId &&
        !c.merged_into &&
        terms.every(
          (t) =>
            `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(t) ||
            (/\d{3}/.test(t) &&
              c.phone.replace(/\D/g, "").includes(t.replace(/\D/g, ""))),
        ),
    )
    .slice(0, 20);
  return (
    <fieldset className="co-buyer-picker" disabled={disabled}>
      <legend>Co-buyer</legend>
      <div className="customer-link-options">
        {(
          [
            ["none", "No co-buyer"],
            ["existing", "Existing customer"],
            ["new", "New customer"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className={value.mode === mode ? "selected" : ""}>
            <input
              type="radio"
              name={id}
              checked={value.mode === mode}
              onChange={() =>
                onChange(
                  mode === "none"
                    ? { mode }
                    : mode === "existing"
                      ? { mode, customer_id: "" }
                      : { mode, person: { ...blankPerson } },
                )
              }
            />
            {mode === "new" ? (
              <UserPlus size={16} />
            ) : mode === "existing" ? (
              <Users size={16} />
            ) : null}
            {label}
          </label>
        ))}
      </div>
      {value.mode === "existing" && (
        <>
          <label className="customer-link-search">
            <span>
              <Search size={15} /> Find an existing customer
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, or email"
              autoComplete="off"
            />
          </label>
          {selected && (
            <div className="customer-link-selected" role="status">
              <strong>Selected: {selected.name}</strong>
              <span>
                {[selected.phone, selected.email].filter(Boolean).join(" · ") ||
                  "No contact details yet"}
              </span>
            </div>
          )}
          <div
            className="customer-link-results"
            aria-label="Co-buyer search results"
          >
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                className={selected?.id === c.id ? "selected" : ""}
                aria-pressed={selected?.id === c.id}
                onClick={() =>
                  onChange({ mode: "existing", customer_id: c.id })
                }
              >
                <strong>{c.name}</strong>
                <span>
                  {[c.phone, c.email].filter(Boolean).join(" · ") ||
                    "No contact details yet"}
                </span>
              </button>
            ))}
            {!matches.length && (
              <p>
                No matching customers. Choose “New customer” to create their
                profile.
              </p>
            )}
          </div>
          <p className="fine-print">
            Their existing profile supplies the co-buyer details. Update
            identification or contact information on that profile.
          </p>
        </>
      )}
      {value.mode === "new" && (
        <>
          <p className="fine-print">
            Saving creates their own customer profile. No separate sales
            opportunity or message is created for them.
          </p>
          <PersonFields
            value={value.person}
            onChange={(person) => onChange({ mode: "new", person })}
            prefix="Co-buyer"
          />
        </>
      )}
    </fieldset>
  );
}

export function CoBuyerDialog({
  ws,
  opportunity,
  busy,
  error,
  run,
  onClose,
}: {
  ws: Workspace;
  opportunity: Opportunity;
  busy: boolean;
  error: string;
  run: (p: Command, message?: string) => Promise<{ ok: boolean; id?: string }>;
  onClose: () => void;
}) {
  const [link, setLink] = useState<CoBuyerLink>(() =>
    coBuyerSelection(opportunity),
  );
  const [expectedUpdatedAt] = useState(opportunity.updated_at);
  const [localError, setLocalError] = useState("");
  const stale = opportunity.updated_at !== expectedUpdatedAt;
  return (
    <Modal
      title="Manage co-buyer"
      subtitle={opportunity.title}
      wide
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = coBuyerLinkSchema.safeParse(link);
          if (!parsed.success) {
            setLocalError(
              link.mode === "existing"
                ? "Select a customer from the results."
                : parsed.error.issues[0].message,
            );
            return;
          }
          setLocalError("");
          if (stale) return;
          const result = await run(
            {
              type: "set_co_buyer",
              opportunity_id: opportunity.id,
              expected_updated_at: expectedUpdatedAt,
              link: parsed.data,
            },
            link.mode === "none"
              ? "Co-buyer removed from this opportunity"
              : "Co-buyer saved",
          );
          if (result.ok) onClose();
        }}
      >
        <p className="fine-print">
          This change applies to this opportunity. Removing a co-buyer keeps
          their customer profile and other deals.
        </p>
        <CoBuyerPicker
          customers={ws.customers}
          buyerId={opportunity.customer_id}
          value={link}
          onChange={setLink}
          disabled={busy}
        />
        {stale && (
          <p className="form-error" role="alert">
            This opportunity changed. Close and reopen this window to review the
            current co-buyer.
          </p>
        )}
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        <div className="modal-footer">
          <span>Completed deals keep their original paperwork.</span>
          <button className="btn primary" disabled={busy || stale}>
            {busy ? "Saving…" : "Save co-buyer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
