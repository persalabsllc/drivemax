"use client";
import { useState } from "react";
import type { Customer, Command, Workspace } from "../lib/model";
import {
  customerRecordCounts,
  mergedCustomerDetails,
} from "../lib/customer-links";
import { personFromCustomer } from "../lib/people";
import { Modal } from "./ui";

export function MergeCustomers({
  ws,
  customer,
  busy,
  error,
  run,
  onClose,
}: {
  ws: Workspace;
  customer: Customer;
  busy: boolean;
  error: string;
  run: (p: Command, message?: string) => Promise<{ ok: boolean; id?: string }>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(customer.name);
  const [sourceId, setSourceId] = useState("");
  const [detailsFrom, setDetailsFrom] = useState<"source" | "target">("target");
  const [reviewed, setReviewed] = useState<{
    source: string;
    target: string;
    details: string;
  } | null>(null);
  const [localError, setLocalError] = useState("");
  const source = ws.customers.find((c) => c.id === sourceId);
  const confirmed =
    !!source &&
    reviewed?.source === source.updated_at &&
    reviewed?.target === customer.updated_at &&
    reviewed?.details === detailsFrom;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = ws.customers
    .filter(
      (c) =>
        c.id !== customer.id &&
        terms.every(
          (t) =>
            `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(t) ||
            (/\d{3}/.test(t) &&
              c.phone.replace(/\D/g, "").includes(t.replace(/\D/g, ""))),
        ),
    )
    .slice(0, 20);
  const details = source
    ? mergedCustomerDetails(customer, source, detailsFrom)
    : null;
  const counts = source ? customerRecordCounts(ws, source.id) : null;
  const targetCounts = customerRecordCounts(ws, customer.id);
  const bothCheckedIn =
    source &&
    [source.id, customer.id].every((id) =>
      ws.visits.some((v) => v.customer_id === id && !v.departed_at),
    );
  const profileDetails = (c: Customer) => {
    const person = personFromCustomer(c);
    return (
      <>
        <strong>{c.name}</strong>
        <span>{c.phone || "No phone"}</span>
        <span>{c.email || "No email"}</span>
        <span>
          {[person.address1, person.city, person.state, person.zip]
            .filter(Boolean)
            .join(", ") || "No address"}
        </span>
      </>
    );
  };
  return (
    <Modal
      title="Merge duplicate profiles"
      subtitle={`Keep one customer record for ${customer.name}.`}
      wide
      onClose={onClose}
    >
      <form
        className="modal-form customer-merge"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!source || !confirmed || bothCheckedIn) {
            setLocalError(
              "Choose the duplicate and confirm both profiles belong to the same person.",
            );
            return;
          }
          setLocalError("");
          const result = await run(
            {
              type: "merge_customers",
              source_id: source.id,
              target_id: customer.id,
              source_updated_at: reviewed!.source,
              target_updated_at: reviewed!.target,
              details_from: detailsFrom,
              confirmed: true,
            },
            "Customer profiles merged; history retained",
          );
          if (result.ok) onClose();
        }}
      >
        <p className="fine-print">
          Use this only for two profiles of the same person. A buyer and
          co-buyer should keep separate profiles.
        </p>
        <fieldset disabled={busy} className="customer-merge-fields">
          <label>
            Find the duplicate profile
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, or email"
            />
          </label>
          <div
            className="customer-link-results"
            aria-label="Duplicate customer search results"
          >
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                className={sourceId === c.id ? "selected" : ""}
                aria-pressed={sourceId === c.id}
                onClick={() => {
                  setSourceId(c.id);
                  setReviewed(null);
                }}
              >
                <strong>{c.name}</strong>
                <span>
                  {[c.phone, c.email].filter(Boolean).join(" · ") ||
                    "No contact details yet"}
                </span>
              </button>
            ))}
            {!matches.length && (
              <p>No matching profiles. Try a shorter name, phone, or email.</p>
            )}
          </div>
          {source && details && counts && (
            <>
              <h3>Which personal details should be kept?</h3>
              <p className="fine-print">
                Name, identification, and address stay together. A missing
                phone, email, birthday, or insurance record is filled from the
                other profile. Previous contact details remain searchable.
              </p>
              <div className="merge-profile-options">
                {(
                  [
                    ["target", customer, "Current profile"],
                    ["source", source, "Duplicate profile"],
                  ] as const
                ).map(([choice, c, label]) => (
                  <label
                    key={choice}
                    className={detailsFrom === choice ? "selected" : ""}
                  >
                    <span>
                      <input
                        type="radio"
                        name="merge-details"
                        checked={detailsFrom === choice}
                        onChange={() => {
                          setDetailsFrom(choice);
                          setReviewed(null);
                        }}
                      />
                      {label}
                    </span>
                    {profileDetails(c)}
                  </label>
                ))}
              </div>
              <div className="merge-summary" role="status">
                <strong>After merging: {details.name}</strong>
                <span>
                  {[details.phone, details.email].filter(Boolean).join(" · ")}
                </span>
                <p>
                  {targetCounts.deals + counts.deals} opportunities ·{" "}
                  {targetCounts.sold + counts.sold} sold deals ·{" "}
                  {targetCounts.messages + counts.messages} messages
                </p>
                <p>
                  All notes, tasks, visits, appointments, and files stay
                  available. Sold records, original documents, and salesperson
                  assignments stay intact. The duplicate leaves the customer
                  list.
                </p>
                {details.email_opt_out && <p>Email opt-out remains enabled.</p>}
              </div>
              {bothCheckedIn && (
                <p className="form-error" role="alert">
                  Both profiles are checked into the showroom. Check one out
                  before merging.
                </p>
              )}
              <label className="checkbox-label merge-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) =>
                    setReviewed(
                      e.target.checked
                        ? {
                            source: source.updated_at,
                            target: customer.updated_at,
                            details: detailsFrom,
                          }
                        : null,
                    )
                  }
                  required
                />
                I verified that these profiles belong to the same person and
                reviewed the details above.
              </label>
            </>
          )}
        </fieldset>
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        <div className="modal-footer">
          <span>The merge is recorded in customer history.</span>
          <button
            className="btn primary"
            disabled={busy || !source || !confirmed || !!bothCheckedIn}
          >
            {busy ? "Merging…" : "Merge profiles"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
