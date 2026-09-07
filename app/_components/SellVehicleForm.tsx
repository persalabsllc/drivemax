"use client";
import { useCallback, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { leadSchema } from "../../lib/inventory";
import {
  accidentHistories,
  loanStatuses,
  titleStatuses,
  vehicleConditions,
} from "../../lib/purchase-requests";
import {
  mergeDecodedFields,
  type DecodedFields,
  type DecodedVehicle,
} from "../../lib/vehicle-data";
import VinLookup from "./VinLookup";
import ContactNotice from "./ContactNotice";

export default function SellVehicleForm({ online }: { online: boolean }) {
  const [vin, setVin] = useState("");
  const [fields, setFields] = useState({
    year: "",
    make: "",
    model: "",
    trim: "",
  });
  const [decoding, setDecoding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const requestId = useRef("");
  const previous = useRef<DecodedFields>({});
  const onDecoded = useCallback((data: DecodedVehicle) => {
    const old = previous.current;
    const identity = {
      year: data.fields.year,
      make: data.fields.make,
      model: data.fields.model,
      trim: data.fields.trim,
    };
    setFields((current) => mergeDecodedFields(current, identity, old));
    previous.current = identity;
  }, []);
  return (
    <form
      className="lead-form sell-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!online || busy || submitted || decoding) return;
        requestId.current ||= crypto.randomUUID();
        const payload = {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          kind: "vehicle",
          purpose: "purchase-offer",
          requestId: requestId.current,
        };
        const parsed = leadSchema.safeParse(payload);
        if (!parsed.success) {
          setError(true);
          setNotice(parsed.error.issues[0].message);
          return;
        }
        setBusy(true);
        setError(false);
        setNotice("");
        try {
          const r = await fetch("/api/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
          });
          const result = await r.json();
          if (!r.ok)
            throw new Error(
              result.error ||
                "Your request was not confirmed. Please try again.",
            );
          setSubmitted(true);
          setNotice(
            "Thanks! We received your vehicle details. The Drive Max team will review them and contact you about a purchase offer or next steps.",
          );
        } catch (err) {
          setError(true);
          setNotice(
            err instanceof Error
              ? err.message
              : "Your request was not confirmed. Please try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || submitted} className="sell-fieldset">
        <div className="lead-honeypot" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div className="sell-form-heading">
          <span className="sell-step">1</span>
          <div>
            <h2>Your vehicle</h2>
            <p>Start with the VIN. We’ll fill in the details we can find.</p>
          </div>
        </div>
        <VinLookup
          name="sellerVin"
          vin={vin}
          onVinChange={setVin}
          onDecoded={onDecoded}
          onBusyChange={setDecoding}
          disabled={busy || submitted}
        />
        <div className="form-grid">
          {(
            [
              ["year", "Year", "sellerYear"],
              ["make", "Make", "sellerMake"],
              ["model", "Model", "sellerModel"],
              ["trim", "Trim (optional)", "sellerTrim"],
            ] as const
          ).map(([key, label, name]) => (
            <div className="field" key={key}>
              <label htmlFor={`sell-${key}`}>{label}</label>
              <input
                id={`sell-${key}`}
                name={name}
                value={fields[key]}
                onChange={(e) =>
                  setFields((current) => ({
                    ...current,
                    [key]: e.target.value,
                  }))
                }
                type={key === "year" ? "number" : "text"}
                min={key === "year" ? 1981 : undefined}
                max={key === "year" ? new Date().getFullYear() + 2 : undefined}
                maxLength={key === "make" ? 60 : key === "model" ? 80 : 100}
                required={key !== "trim"}
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="sell-miles">Mileage</label>
            <input
              id="sell-miles"
              name="sellerMiles"
              type="number"
              inputMode="numeric"
              min={0}
              max={2000000}
              step={1}
              required
              placeholder="e.g. 85000"
            />
          </div>
          <div className="field">
            <label htmlFor="sell-price">
              Asking price <span className="optional">(optional)</span>
            </label>
            <input
              id="sell-price"
              name="askingPrice"
              type="number"
              inputMode="decimal"
              min={1}
              max={2000000}
              step="0.01"
              placeholder="Your target price ($)"
            />
          </div>
          <div className="field">
            <label htmlFor="sell-condition">Overall condition</label>
            <select
              id="sell-condition"
              name="condition"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Choose condition
              </option>
              {vehicleConditions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sell-title">Title status</label>
            <select id="sell-title" name="titleStatus" defaultValue="" required>
              <option value="" disabled>
                Choose title status
              </option>
              {titleStatuses.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sell-accidents">Accident or damage history</label>
            <select
              id="sell-accidents"
              name="accidentHistory"
              defaultValue="Not sure"
            >
              {accidentHistories.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sell-loan">Loan or lease</label>
            <select id="sell-loan" name="loanStatus" defaultValue="Not sure">
              {loanStatuses.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field field-full">
            <label htmlFor="sell-details">
              Anything else we should know?{" "}
              <span className="optional">(optional)</span>
            </label>
            <textarea
              id="sell-details"
              name="message"
              rows={4}
              maxLength={6000}
              placeholder="Recent service, repairs needed, warning lights, tire condition, modifications, or when you’re ready to sell."
            />
          </div>
        </div>
        <div className="sell-form-heading">
          <span className="sell-step">2</span>
          <div>
            <h2>How can we reach you?</h2>
            <p>Choose the best way for our team to follow up.</p>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sell-name">Your name</label>
            <input
              id="sell-name"
              name="name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="sell-zip">ZIP code</label>
            <input
              id="sell-zip"
              name="sellerZip"
              inputMode="numeric"
              autoComplete="postal-code"
              pattern="[0-9]{5}(-[0-9]{4})?"
              maxLength={10}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sell-email">Email address</label>
            <input
              id="sell-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
            />
          </div>
          <div className="field">
            <label htmlFor="sell-phone">Phone number</label>
            <input
              id="sell-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              placeholder="(252) 555-0123"
              required
              aria-describedby="sell-contact-hint"
            />
          </div>
          <div className="field field-full">
            <label htmlFor="sell-contact">Preferred contact method</label>
            <select id="sell-contact" name="preferredContact">
              <option>Email</option>
              <option>Phone call</option>
              <option>Text message</option>
            </select>
          </div>
        </div>
        <p id="sell-contact-hint" className="form-instruction">
          A phone number is required. Add your email address if you’d prefer an
          email reply.
        </p>
        <p className="form-help">
          Any purchase offer is confirmed after a vehicle inspection and title review.
        </p>
        <ContactNotice id="sell-contact-notice" />
        <div className="form-footer">
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || submitted || decoding || !online}
            aria-describedby="sell-contact-notice"
          >
            {submitted ? (
              <>
                <CheckCircle2 size={18} aria-hidden="true" />
                Request received
              </>
            ) : busy ? (
              "Sending…"
            ) : (
              <>
                Request a purchase offer
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </fieldset>
      {!online && (
        <p className="form-status">
          Online requests are temporarily unavailable.{" "}
          <a href="mailto:sales@drivemaxusedcars.com">
            Email sales@drivemaxusedcars.com
          </a>{" "}
          with your vehicle details.
        </p>
      )}
      {notice && (
        <p
          role={error ? "alert" : "status"}
          className={`form-status${error ? " form-status-error" : ""}`}
        >
          {notice}
        </p>
      )}
    </form>
  );
}
