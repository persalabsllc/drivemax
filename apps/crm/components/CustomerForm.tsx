"use client";
import { useEffect, useState } from "react";
import { Camera, CheckCircle2 } from "lucide-react";
import dynamic from "next/dynamic";
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
import { CoBuyerPicker } from "./CoBuyerPicker";
import { coBuyerSelection, type CoBuyerLink } from "../lib/customer-links";
import type { LicenseCapture } from "../lib/license-scan";
import { saveCustomerLicense } from "../lib/customer-license-client";
import {
  findCustomerMatches,
  duplicateError,
  type CustomerMatch,
} from "../lib/customer-matches";
const LicenseScanner = dynamic(
  () => import("./LicenseScanner").then((m) => m.LicenseScanner),
  { ssr: false },
);
export function CustomerForm({
  existing,
  ws,
  busy,
  error,
  submit,
  onComplete,
  onOpenMatch,
  onUseExisting,
  demo = false,
  purpose = "customer",
}: {
  existing: Customer | null;
  ws: Workspace;
  busy: boolean;
  error: string;
  demo?: boolean;
  onComplete: (id: string) => void;
  onOpenMatch?: (id: string, newOpportunity: boolean) => void;
  onUseExisting?: (
    id: string,
    source: string,
  ) => Promise<{ ok: boolean; id?: string }>;
  purpose?: "customer" | "quick_quote";
  submit: (
    c: Extract<Command, { type: "create_customer" }>["customer"],
    appointment?: NewCustomerAppointment,
  ) => Promise<{ ok: boolean; id?: string }>;
}) {
  const [person, setPerson] = useState(() =>
      existing ? personFromCustomer(existing) : { ...blankPerson },
    ),
    [coLink, setCoLink] = useState<CoBuyerLink>(() =>
      existing ? coBuyerSelection(existing) : { mode: "none" },
    ),
    [createOpp, setCreateOpp] = useState(true),
    [schedule, setSchedule] = useState(false),
    [appointmentId] = useState(() => crypto.randomUUID()),
    [appointment, setAppointment] = useState(() => appointmentFormValue(ws)),
    [localError, setLocalError] = useState(""),
    [birthday, setBirthday] = useState(existing?.birthday ?? ""),
    [scanning, setScanning] = useState(false),
    [license, setLicense] = useState<LicenseCapture | null>(null),
    [licensePreview, setLicensePreview] = useState(""),
    [saving, setSaving] = useState(false),
    [savedId, setSavedId] = useState<string | null>(null),
    [matches, setMatches] = useState<CustomerMatch[]>([]),
    [matchError, setMatchError] = useState(""),
    [matchLoading, setMatchLoading] = useState(false),
    [matchRevision, setMatchRevision] = useState(0),
    [reviewedMatches, setReviewedMatches] = useState("");
  const matchInput = {
    phone: person.phone,
    email: person.email,
    license_number: person.license_number,
    license_state: person.license_state,
  };
  const matchSignature = JSON.stringify(matchInput);
  const matchKey = (found: CustomerMatch[]) =>
    matchSignature +
    ":" +
    found
      .map((m) => m.id)
      .sort()
      .join(",");
  useEffect(() => {
    if (existing || savedId) return;
    const controller = new AbortController();
    setMatchLoading(true);
    setMatchError("");
    setMatches([]);
    const timer = setTimeout(() => {
      void findCustomerMatches(
        ws,
        JSON.parse(matchSignature),
        demo,
        controller.signal,
      )
        .then((found) => {
          if (!controller.signal.aborted) setMatches(found);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setMatchError(
              "Customer matches could not be checked. Please retry before saving.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setMatchLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    matchSignature,
    demo,
    existing,
    savedId,
    matchRevision,
    ws.customers,
    ws.customer_aliases,
  ]);
  async function useMatch(
    match: CustomerMatch,
    newOpportunity: boolean,
    source: string,
  ) {
    if (saving || busy) return;
    setSaving(true);
    setLocalError("");
    try {
      if (onUseExisting) {
        const result = await onUseExisting(match.id, source);
        if (!result.ok) return;
        setSavedId(match.id);
        await finish(match.id);
      } else {
        if (license) await saveCustomerLicense(match.id, license, demo);
        onOpenMatch?.(match.id, newOpportunity);
      }
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "The existing customer could not be opened. Please retry.",
      );
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!license) {
      setLicensePreview("");
      return;
    }
    const url = URL.createObjectURL(license.file);
    setLicensePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [license]);
  async function finish(id: string) {
    if (license) await saveCustomerLicense(id, license, demo);
    onComplete(id);
  }
  return (
    <form
      className="modal-form customer-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || busy) return;
        if (savedId) {
          setSaving(true);
          setLocalError("");
          try {
            await finish(savedId);
          } catch (err) {
            setLocalError(
              err instanceof Error
                ? err.message
                : "Customer saved. Retry the license photo upload.",
            );
          } finally {
            setSaving(false);
          }
          return;
        }
        const f = new FormData(e.currentTarget);
        const data = {
          name: fullName(person),
          phone: person.phone,
          email: person.email,
          person,
          co_buyer_link: coLink,
          birthday: birthday || null,
          source: String(f.get("source")),
          status: existing?.status ?? "new",
          vehicle_interest: existing?.vehicle_interest ?? "",
          trade_vehicle: existing?.trade_vehicle ?? "",
          initial_opportunity: createOpp,
          duplicate_reviewed_ids: [] as string[],
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
        setSaving(true);
        try {
          if (!existing) {
            const found = await findCustomerMatches(ws, matchInput, demo);
            setMatches(found);
            setMatchError("");
            if (found.length && reviewedMatches !== matchKey(found)) {
              setLocalError(duplicateError);
              return;
            }
            data.duplicate_reviewed_ids = found.map((m) => m.id);
          }
          const result = await submit(data, scheduled);
          if (!result.ok) {
            setMatchRevision((n) => n + 1);
            return;
          }
          const id = result.id ?? existing?.id;
          if (!id)
            throw Error(
              "The customer was saved, but the license could not be linked. Reopen the customer profile to attach it.",
            );
          setSavedId(id);
          await finish(id);
        } catch (err) {
          setLocalError(
            err instanceof Error
              ? err.message
              : "Customer saved. Retry the license photo upload.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      {scanning && (
        <LicenseScanner
          onClose={() => setScanning(false)}
          onScan={(details, capture) => {
            if (details) {
              setPerson((current) => ({ ...current, ...details.person }));
              setBirthday(details.birthday);
            }
            setLicense(capture);
            setScanning(false);
            setLocalError("");
          }}
        />
      )}
      <fieldset
        className="customer-editor-fields"
        disabled={busy || saving || !!savedId}
      >
        <div className="license-entry">
          <div>
            <h3>Buyer information</h3>
            <p>
              Scan a license to fill in the name, address, license number and
              birthday.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setScanning(true)}
          >
            <Camera size={16} />
            {license ? "Replace license scan" : "Scan driver license"}
          </button>
        </div>
        {license && (
          <div className="license-pending">
            {licensePreview && (
              <img
                src={licensePreview}
                alt="License ready to save with this customer"
              />
            )}
            <div>
              <strong>
                <CheckCircle2 size={16} />
                License photo ready
              </strong>
              <p>
                Review the customer details below. The photo saves with this
                customer and can be included in sold packs.
              </p>
              <button
                type="button"
                className="text-btn"
                onClick={() => setLicense(null)}
              >
                Remove pending photo
              </button>
            </div>
          </div>
        )}
        {!existing && (
          <section
            className="customer-match-review"
            aria-label="Duplicate customer check"
            aria-live="polite"
          >
            {matchLoading && (
              <p className="fine-print">Checking existing customers…</p>
            )}
            {matchError && (
              <p className="form-error">
                {matchError}{" "}
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setMatchRevision((n) => n + 1)}
                >
                  Retry match check
                </button>
              </p>
            )}
            {!!matches.length && (
              <>
                <h3>
                  Possible existing customer{matches.length === 1 ? "" : "s"}
                </h3>
                <p>
                  Choose the existing customer, or confirm that this is a
                  different person.
                </p>
                {matches.map((match) => (
                  <article key={match.id}>
                    <div>
                      <strong>{match.name}</strong>
                      <small>
                        {match.reasons.join(" · ")} match ·{" "}
                        {match.phone || match.email}
                      </small>
                    </div>
                    <div className="match-actions">
                      {onUseExisting ? (
                        <button
                          type="button"
                          className="btn small"
                          onClick={(e) =>
                            void useMatch(
                              match,
                              true,
                              String(
                                new FormData(e.currentTarget.form!).get(
                                  "source",
                                ),
                              ),
                            )
                          }
                        >
                          Save quote on this customer
                        </button>
                      ) : (
                        onOpenMatch && (
                          <>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => void useMatch(match, false, "")}
                            >
                              {license
                                ? "Save scan & open profile"
                                : "Open profile"}
                            </button>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => void useMatch(match, true, "")}
                            >
                              {license
                                ? "Save scan & new opportunity"
                                : "New opportunity"}
                            </button>
                          </>
                        )
                      )}
                    </div>
                  </article>
                ))}
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={reviewedMatches === matchKey(matches)}
                    onChange={(e) =>
                      setReviewedMatches(
                        e.target.checked ? matchKey(matches) : "",
                      )
                    }
                  />
                  I reviewed these matches. This is a different person and needs
                  a separate profile.
                </label>
              </>
            )}
          </section>
        )}
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
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
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
                "Co-buyer",
                "Other",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <section className="editor-section">
          {existing && (
            <>
              <h3>Default co-buyer for new opportunities</h3>
              <p className="fine-print">
                Existing deals keep their selected co-buyer. Use “Manage
                co-buyer” on an opportunity to change that deal.
              </p>
            </>
          )}
          <CoBuyerPicker
            customers={ws.customers}
            buyerId={existing?.id}
            value={coLink}
            onChange={setCoLink}
            disabled={busy}
          />
        </section>
        {!existing && purpose !== "quick_quote" && (
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
      </fieldset>
      {savedId && license && (
        <p className="license-save-notice" role="status">
          Customer details are saved.{" "}
          {saving
            ? "Saving the license photo…"
            : "Retry to finish saving the license photo; this will not create another customer."}
        </p>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="modal-footer">
        <span>
          {purpose === "quick_quote"
            ? "Your quote will be saved on this customer’s new opportunity."
            : "Vehicle and trade details are saved on opportunities."}
        </span>
        <button className="btn primary" disabled={busy || saving}>
          {busy || saving
            ? "Saving…"
            : savedId
              ? "Retry license upload"
              : existing
                ? "Save customer"
                : purpose === "quick_quote"
                  ? "Create customer & save quote"
                  : schedule
                    ? "Create customer & appointment"
                    : "Create customer"}
        </button>
      </div>
    </form>
  );
}
