"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMessage, saveLead } from "./actions";
import { leadStatuses } from "../../lib/inventory";
import { contactNoticeKeys } from "../../lib/contact-notice";
import {
  isVehicleSnapshotKey,
  type LeadVehicle,
} from "../../lib/lead-vehicles";
import VehicleAssignment from "./VehicleAssignment";
import type { Lead, Message, Staff } from "../../lib/crm-types";
import {
  isPurchaseRequest,
  leadLabel,
  purchaseLabels,
  purchaseOfferDraft,
} from "../../lib/purchase-requests";

function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function LeadEditor({
  lead,
  messages,
  staff,
  canEmail,
  vehicle,
  vehicles,
}: {
  lead: Lead;
  messages: Message[];
  staff: Staff[];
  canEmail: boolean;
  vehicle: LeadVehicle | null;
  vehicles: LeadVehicle[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [messageId, setMessageId] = useState("");
  const [direction, setDirection] = useState("note");
  const [body, setBody] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const purchaseRequest = isPurchaseRequest(lead);
  const details = Object.entries(lead.details).filter(
    ([key, value]) =>
      key !== "purpose" &&
      !isVehicleSnapshotKey(key) &&
      !contactNoticeKeys.some((noticeKey) => noticeKey === key) &&
      !(key === "vehicle" && lead.details.originalVehicleId) &&
      value,
  );
  const [retry, setRetry] = useState<{
    id: string;
    body: string;
    direction: string;
  } | null>(null);
  async function save(form: FormData) {
    setBusy(true);
    try {
      const result = await saveLead(form);
      setNotice(result.error || result.message || "");
      setIsError(!!result.error);
      if (!result.error) router.refresh();
    } catch {
      setNotice("Could not save this update. Try again.");
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cr-panel cr-form">
      <div className="cr-section-heading">
        <div>
          <span className="kicker">Customer conversation</span>
          <h2>{lead.name}</h2>
          <p className="cr-muted">
            {leadLabel(lead)} · Prefers {lead.preferred_contact.toLowerCase()}
          </p>
        </div>
        <span className={`cr-badge ${lead.status}`}>{lead.status}</span>
      </div>
      <div className="cr-contact-row">
        {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
        {lead.phone && (
          <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>{lead.phone}</a>
        )}
      </div>
      {lead.details.originalVehicleId && (
        <details className="cr-original-vehicle">
          <summary>
            Original inquiry vehicle: {lead.details.originalVehicleTitle}
          </summary>
          <dl className="cr-details">
            <div>
              <dt>Original VIN</dt>
              <dd>{lead.details.originalVehicleVin}</dd>
            </div>
            <div>
              <dt>Recorded mileage</dt>
              <dd>
                {Number(lead.details.originalVehicleMiles).toLocaleString(
                  "en-US",
                )}{" "}
                miles
              </dd>
            </div>
            <div>
              <dt>Original stock number</dt>
              <dd>{lead.details.originalVehicleStock}</dd>
            </div>
          </dl>
          <p className="cr-muted">
            Saved{" "}
            {new Date(lead.details.originalVehicleCapturedAt).toLocaleString(
              "en-US",
              { timeZone: "America/New_York" },
            )}{" "}
            ET. Retained when the assigned vehicle changes.
          </p>
        </details>
      )}
      {details.length > 0 && (
        <dl className="cr-details">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt>{purchaseLabels[k] || k.replace(/([A-Z])/g, " $1")}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {lead.details.contactNoticeText && (
        <details className="cr-contact-notice">
          <summary>Website inquiry contact notice</summary>
          <p>{lead.details.contactNoticeText}</p>
          <p>
            Version: {lead.details.contactNoticeVersion}<br />
            Submitted: {lead.details.contactNoticeSubmittedAt}<br />
            This records the inquiry notice, not an opt-in to automated marketing.
          </p>
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const raw = String(f.get("follow_up_at") || "");
          f.set("follow_up_at", raw ? new Date(raw).toISOString() : "");
          void save(f);
        }}
        className="cr-form"
      >
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="updated_at" value={lead.updated_at} />
        <VehicleAssignment
          key={`${lead.id}-${lead.updated_at}`}
          vehicle={vehicle}
          vehicles={vehicles}
          disabled={busy}
        />
        <fieldset disabled={busy} className="cr-fieldset cr-grid three">
          <label>
            Lead stage
            <select name="status" defaultValue={lead.status}>
              {leadStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Assigned to
            <select name="assigned_to" defaultValue={lead.assigned_to || ""}>
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Follow-up <span className="cr-muted">(your local time)</span>
            <input
              suppressHydrationWarning
              name="follow_up_at"
              type="datetime-local"
              defaultValue={localDate(lead.follow_up_at)}
            />
          </label>
        </fieldset>
        <button disabled={busy} className="button button-secondary">
          Update lead
        </button>
      </form>
      <h3>Conversation & notes</h3>
      <div className="cr-thread">
        {messages.map((m) => (
          <article className={`cr-message ${m.direction}`} key={m.id}>
            <div>
              <strong>
                {m.direction === "inbound"
                  ? "Customer"
                  : m.direction === "note"
                    ? "Internal note"
                    : "Drive Max email"}
              </strong>
              <span>
                {m.state} ·{" "}
                {new Date(m.created_at).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                })}{" "}
                ET
              </span>
            </div>
            <p>{m.body}</p>
            {m.direction === "outbound" &&
              ["pending", "failed"].includes(m.state) && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => {
                    setRetry({ id: m.id, body: m.body, direction: "outbound" });
                    setDirection("outbound");
                    setBody(m.body);
                    setMessageId(m.id);
                  }}
                >
                  Retry this message
                </button>
              )}
          </article>
        ))}
      </div>
      {!canEmail && (
        <p className="cr-status-help">
          Email replies become available once dealership email is connected.
          Internal notes are available now.
        </p>
      )}
      {purchaseRequest && (
        <div className="cr-offer-draft">
          <h3>Prepare a purchase offer</h3>
          <p className="cr-muted">
            Enter your offer to prepare an email below. Review the wording, then
            choose Send email.
          </p>
          <div className="cr-offer-controls">
            <label>
              Offer amount ($)
              <input
                type="number"
                min="1"
                max="2000000"
                step="0.01"
                value={offerAmount}
                disabled={busy || !!retry}
                onChange={(e) => setOfferAmount(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={
                busy ||
                !!retry ||
                !!body.trim() ||
                !canEmail ||
                !lead.email ||
                !purchaseOfferDraft(lead, offerAmount)
              }
              onClick={() => {
                setBody(purchaseOfferDraft(lead, offerAmount));
                setDirection("outbound");
                setMessageId("");
                setNotice(
                  "Offer email prepared below. Review it before sending.",
                );
                setIsError(false);
              }}
            >
              Prepare offer email
            </button>
          </div>
          {body.trim() && !retry && (
            <p className="cr-muted">
              Finish or clear your current message before preparing an offer.
            </p>
          )}
          {!lead.email && (
            <p className="cr-muted">
              This customer supplied a phone number only. Contact them by phone
              and record the offer as an internal note.
            </p>
          )}
        </div>
      )}
      <form
        className="cr-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setIsError(false);
          const id = messageId || crypto.randomUUID();
          setMessageId(id);
          const f = new FormData();
          f.set("id", id);
          f.set("lead_id", lead.id);
          f.set("direction", direction);
          f.set("body", body);
          try {
            const r = await addMessage(f);
            setNotice(r.error || r.message || "");
            setIsError(!!r.error);
            if (!r.error) {
              setBody("");
              setMessageId("");
              setRetry(null);
              router.refresh();
            } else setRetry({ id, body, direction });
          } catch {
            setNotice(
              "Message status is uncertain. Retry this same message to check it.",
            );
            setIsError(true);
            setRetry({ id, body, direction });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          New message
          <select
            disabled={busy || !!retry}
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              setMessageId("");
            }}
          >
            <option value="note">Internal note / call or text log</option>
            <option value="outbound" disabled={!canEmail || !lead.email}>
              Email customer
            </option>
          </select>
        </label>
        <label>
          {direction === "note" ? "Note" : "Reply"}
          <textarea
            rows={5}
            required
            maxLength={10000}
            value={body}
            readOnly={!!retry}
            disabled={busy}
            onChange={(e) => {
              setBody(e.target.value);
              setMessageId("");
            }}
          />
        </label>
        <div className="cr-contact-row">
          <button
            disabled={busy || !body.trim()}
            className="button button-primary"
          >
            {busy
              ? "Working…"
              : retry
                ? "Retry same message"
                : direction === "note"
                  ? "Save note"
                  : "Send email"}
          </button>
          {retry && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setRetry(null);
                setMessageId("");
                setBody("");
              }}
            >
              Close retry
            </button>
          )}
        </div>
        {direction === "outbound" && (
          <p className="cr-muted">
            To: {lead.email}. Customer replies appear in this conversation.
          </p>
        )}
      </form>
      <p
        className={isError ? "cr-error" : "cr-success"}
        role={isError ? "alert" : "status"}
      >
        {notice}
      </p>
    </section>
  );
}
