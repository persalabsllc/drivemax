"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { leadVehicleTitle, type LeadVehicle } from "../../lib/lead-vehicles";
import { isValidLeadPhone, phoneValidationMessage } from "../../lib/lead-phone";
import {
  CONTACT_NOTICE_TEXT,
  smsConsentSummary,
  smsPreferenceError,
} from "../../lib/contact-notice";
import ContactNotice from "./ContactNotice";

type LeadFormKind = "vehicle" | "contact" | "finance" | "employment";

const subjects: Record<LeadFormKind, string> = {
  vehicle: "Vehicle request from drivemaxusedcars.com",
  contact: "Website inquiry for Drive Max Used Cars",
  finance: "Financing request from drivemaxusedcars.com",
  employment: "Employment inquiry from drivemaxusedcars.com",
};

const labels: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  preferredContact: "Preferred contact method",
  vehicleType: "Vehicle type",
  budget: "Budget range",
  vehicle: "Vehicle of interest",
  downPayment: "Planned down payment",
  reason: "Reason for contacting us",
  position: "Position or area of interest",
  message: "Message",
  experience: "Experience",
  contactNoticeVersion: "Website contact notice version",
  smsConsent: "Customer care text message consent",
};

function Field({
  id,
  label,
  name,
  type = "text",
  placeholder,
  required = false,
  optional = false,
  autoComplete,
  describedBy,
  invalid = false,
}: {
  id: string;
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  autoComplete?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="optional">(optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

export default function LeadForm({
  kind,
  online = false,
  vehicleId = "",
  vehicle,
  employmentPosition,
}: {
  kind: LeadFormKind;
  online?: boolean;
  vehicleId?: string;
  vehicle?: LeadVehicle;
  employmentPosition?: string;
}) {
  const application = kind === "employment" && !!employmentPosition;
  const subject = application
    ? `Application: ${employmentPosition} — Drive Max Used Cars`
    : subjects[kind];
  const priceRequest = kind === "vehicle" && vehicle?.status === "available";
  const purpose = vehicle
    ? priceRequest
      ? "price-request"
      : vehicle.status === "sold"
        ? "similar-vehicle"
        : "vehicle-update"
    : undefined;
  const vehicleName = vehicle ? leadVehicleTitle(vehicle) : "";
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const requestId = useRef("");
  const [status, setStatus] = useState<{
    type: "info" | "error";
    message: string;
  } | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const contactHintId = `${kind}-contact-hint`;
  const statusId = `${kind}-form-status`;

  useEffect(() => {
    if (status?.type === "error") statusRef.current?.focus();
  }, [status]);

  function showError(message: string, fields: string[] = []) {
    setInvalidFields(fields);
    setStatus({ type: "error", message });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const preferredContact = String(
      formData.get("preferredContact") || "Email",
    );

    if (!isValidLeadPhone(phone)) {
      showError(phoneValidationMessage, ["phone"]);
      return;
    }
    if (preferredContact === "Email" && !email) {
      showError(
        "Please add an email address or choose phone call or text message as your preferred contact method.",
        ["email"],
      );
      return;
    }
    const consentError = smsPreferenceError(
      preferredContact,
      formData.get("smsConsent"),
      formData.get("contactNoticeVersion"),
    );
    if (consentError) {
      showError(consentError, ["smsConsent"]);
      return;
    }

    setInvalidFields([]);
    if (online) {
      if (busy || submitted) return;
      setBusy(true);
      requestId.current ||= crypto.randomUUID();
      try {
        const response = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...Object.fromEntries(formData),
            kind,
            vehicleId: vehicle?.id || vehicleId,
            purpose,
            requestId: requestId.current,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Please try again.");
        setSubmitted(true);
        setStatus({
          type: "info",
          message: priceRequest
            ? `Thanks! Your price request for the ${vehicleName} has been received. We’ll follow up with pricing and availability using your preferred contact method.`
            : "Thanks! Your inquiry has been received. The Drive Max team will follow up using your preferred contact method.",
        });
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Your inquiry was not confirmed. Please try again.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const details = Array.from(formData.entries())
      .filter(([key, value]) => key !== "smsConsent" && String(value).trim())
      .map(([key, value]) => `${labels[key] || key}: ${String(value).trim()}`);
    details.push(
      `Customer care text message consent: ${smsConsentSummary(formData.get("smsConsent"))}`,
    );
    if (vehicle)
      details.unshift(
        `${priceRequest ? "Price request" : "Vehicle inquiry"}: ${vehicleName}`,
        `VIN: ${vehicle.vin}`,
        `Stock: ${vehicle.stock_number}`,
        `Listed mileage: ${vehicle.miles.toLocaleString("en-US")} miles`,
      );
    const body = [
      application
        ? `Application for ${employmentPosition} at Drive Max Used Cars`
        : "New inquiry from the Drive Max Used Cars website",
      "",
      ...details,
      "",
      "Please respond using the contact information above.",
      "",
      `Contact notice shown with this request: ${CONTACT_NOTICE_TEXT}`,
    ].join("\n");

    setStatus({
      type: "info",
      message: application
        ? "Your email app should open with your application prepared. You can attach a résumé, then review and press Send to finish. If it doesn’t open, email your contact details, experience, and position title to sales@drivemaxusedcars.com."
        : "Your email app should open with the request prepared. Review it and press Send to finish.",
    });
    window.location.href = `mailto:sales@drivemaxusedcars.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const messageOptional = kind === "vehicle" || kind === "finance";
  const messageName = kind === "employment" ? "experience" : "message";

  return (
    <form
      className="lead-form"
      action={`mailto:sales@drivemaxusedcars.com?subject=${encodeURIComponent(subject)}`}
      method="post"
      encType="text/plain"
      onSubmit={handleSubmit}
    >
      {online && (
        <div className="lead-honeypot" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      )}
      <div className="form-grid">
        {application && (
          <div className="field field-full">
            <label htmlFor={`${kind}-position`}>
              Position you’re applying for
            </label>
            <input
              id={`${kind}-position`}
              name="position"
              value={employmentPosition}
              readOnly
            />
          </div>
        )}
        {vehicle && (
          <div className="inquiry-vehicle-summary field-full">
            <span className="kicker">
              {vehicle.status === "sold"
                ? "Original vehicle of interest · sold"
                : "Selected vehicle"}
            </span>
            <strong>{vehicleName}</strong>
            <span>
              Stock {vehicle.stock_number} ·{" "}
              {vehicle.miles.toLocaleString("en-US")} miles
            </span>
            <small>VIN: {vehicle.vin}</small>
          </div>
        )}
        <p id={contactHintId} className="form-instruction field-full">
          A phone number is required. Add your email address if you’d prefer an
          email reply.
        </p>
        <Field
          id={`${kind}-name`}
          label="Your name"
          name="name"
          placeholder="First and last name"
          required
          autoComplete="name"
        />
        <Field
          id={`${kind}-email`}
          label="Email address"
          name="email"
          type="email"
          placeholder="you@example.com"
          optional
          autoComplete="email"
          describedBy={`${contactHintId}${status?.type === "error" ? ` ${statusId}` : ""}`}
          invalid={invalidFields.includes("email")}
        />
        <Field
          id={`${kind}-phone`}
          label="Phone number (mobile for texts)"
          name="phone"
          type="tel"
          placeholder="(252) 555-0123"
          required
          autoComplete="tel"
          describedBy={`${contactHintId}${status?.type === "error" ? ` ${statusId}` : ""}`}
          invalid={invalidFields.includes("phone")}
        />
        <div className="field">
          <label htmlFor={`${kind}-preferredContact`}>
            Preferred contact method
          </label>
          <select
            id={`${kind}-preferredContact`}
            name="preferredContact"
            defaultValue="Email"
            aria-describedby={contactHintId}
          >
            <option>Email</option>
            <option>Phone call</option>
            <option>Text message</option>
          </select>
        </div>

        {kind === "vehicle" && !vehicle && (
          <>
            <div className="field">
              <label htmlFor={`${kind}-vehicleType`}>
                What are you shopping for?
              </label>
              <select
                id={`${kind}-vehicleType`}
                name="vehicleType"
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a vehicle type
                </option>
                <option>Sedan</option>
                <option>SUV or crossover</option>
                <option>Truck</option>
                <option>Minivan</option>
                <option>Coupe or convertible</option>
                <option>Not sure yet</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${kind}-budget`}>
                Target budget <span className="optional">(optional)</span>
              </label>
              <select id={`${kind}-budget`} name="budget" defaultValue="">
                <option value="">Choose a range</option>
                <option>Under $10,000</option>
                <option>$10,000–$15,000</option>
                <option>$15,000–$20,000</option>
                <option>$20,000 or more</option>
                <option>Help me decide</option>
              </select>
            </div>
          </>
        )}

        {kind === "contact" && (
          <div className="field field-full">
            <label htmlFor={`${kind}-reason`}>How can we help?</label>
            <select
              id={`${kind}-reason`}
              name="reason"
              defaultValue="Vehicle availability"
            >
              <option>Vehicle availability</option>
              <option>Schedule a visit</option>
              <option>Financing question</option>
              <option>Trade-in question</option>
              <option>Existing customer</option>
              <option>Something else</option>
            </select>
          </div>
        )}

        {kind === "finance" && (
          <>
            <Field
              id={`${kind}-vehicle`}
              label="Vehicle of interest"
              name="vehicle"
              placeholder="Make, model, or body style"
              optional
            />
            <div className="field">
              <label htmlFor={`${kind}-downPayment`}>
                Planned down payment{" "}
                <span className="optional">(optional)</span>
              </label>
              <select
                id={`${kind}-downPayment`}
                name="downPayment"
                defaultValue=""
              >
                <option value="">Choose a range</option>
                <option>Under $1,000</option>
                <option>$1,000–$2,499</option>
                <option>$2,500–$4,999</option>
                <option>$5,000 or more</option>
                <option>Not sure yet</option>
              </select>
            </div>
          </>
        )}

        {kind === "employment" && !application && (
          <Field
            id={`${kind}-position`}
            label="Position or area of interest"
            name="position"
            placeholder="Sales, service, office, etc."
            required
          />
        )}

        <div className="field field-full">
          <label htmlFor={`${kind}-${messageName}`}>
            {kind === "employment"
              ? "Tell us about your experience"
              : kind === "contact"
                ? "Message"
                : "Anything else we should know?"}
            {messageOptional && <span className="optional"> (optional)</span>}
          </label>
          <textarea
            id={`${kind}-${messageName}`}
            name={messageName}
            placeholder={
              application
                ? "Share your sales or customer service experience, why you’re interested in this role, and your availability or earliest start date."
                : priceRequest
                  ? "Any questions about this vehicle or its price?"
                  : vehicle
                    ? "What would you like to know, or what are you looking for?"
                    : kind === "vehicle"
                      ? "Preferred makes, must-have features, mileage limits, or timing"
                      : kind === "finance"
                        ? "Vehicle needs, timing, or questions for the dealership"
                        : "How can Drive Max help?"
            }
            required={!messageOptional}
          />
        </div>
      </div>

      <ContactNotice
        id={`${kind}-contact-notice`}
        disabled={busy || submitted}
      />

      <div className="form-footer">
        <p className="form-help">
          {online
            ? "Your request goes directly to the Drive Max team."
            : application
              ? "Prepare your application email, attach a résumé if you’d like, then press Send in your email app."
              : "This button opens your email app with the message prepared. Nothing is sent until you review it and press Send."}
        </p>
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || submitted}
          aria-describedby={`${kind}-contact-notice`}
        >
          {busy
            ? "Sending…"
            : submitted
              ? "Request received"
              : online
                ? priceRequest
                  ? "Request your price"
                  : "Send inquiry"
                : application
                  ? "Prepare application email"
                  : "Open email to send"}{" "}
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </div>

      {status && (
        <p
          ref={statusRef}
          id={statusId}
          className={`form-status ${status.type === "error" ? "form-status-error" : ""}`}
          role={status.type === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {status.message}
        </p>
      )}
    </form>
  );
}
