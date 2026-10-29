"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { blankInsurance, insuranceSchema, type Insurance } from "../lib/people";
import {
  customerInsurance,
  insuranceImageUrl,
  saveCustomerInsurance,
} from "../lib/customer-insurance-client";
import type {
  InsuranceCapture,
  SavedInsuranceCard,
} from "../lib/insurance-scan";
const InsuranceScanner = dynamic(() => import("./InsuranceScanner"), {
  ssr: false,
});
export function InsuranceForm({
  initial,
  busy,
  onSave,
  readOnly = false,
  customerId,
  opportunityId,
  demo,
  vehicleVin,
  onRefresh,
}: {
  initial: Insurance | null | undefined;
  busy: boolean;
  onSave: (v: Insurance) => Promise<{ ok: boolean }>;
  readOnly?: boolean;
  customerId: string;
  opportunityId: string | null;
  demo: boolean;
  vehicleVin?: string;
  onRefresh?: () => Promise<void>;
}) {
  const [v, setV] = useState<Insurance>({ ...blankInsurance, ...initial });
  const [scanner, setScanner] = useState(false),
    [pending, setPending] = useState<InsuranceCapture | null>(null),
    [policySaved, setPolicySaved] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [card, setCard] = useState<SavedInsuranceCard | null>(null),
    [revision, setRevision] = useState(0),
    [cardError, setCardError] = useState("");
  const policyKey = JSON.stringify(initial);
  useEffect(() => {
    const controller = new AbortController();
    setCard(null);
    setCardError("");
    void customerInsurance(
      customerId,
      opportunityId,
      demo,
      initial,
      controller.signal,
    )
      .then((c) => {
        if (!controller.signal.aborted) setCard(c);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCardError("The saved card could not be checked.");
      });
    return () => controller.abort();
  }, [customerId, opportunityId, demo, policyKey, revision]); // policyKey tracks saved policy changes
  const locked = busy || uploading || policySaved;
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
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (uploading || busy) return;
          setError("");
          const parsed = insuranceSchema.safeParse(v);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setUploading(true);
          try {
            if (!policySaved) {
              const saved = await onSave(parsed.data);
              if (!saved.ok) return;
              if (pending) setPolicySaved(true);
            }
            if (pending) {
              await saveCustomerInsurance(
                customerId,
                opportunityId,
                pending,
                parsed.data,
                demo,
              );
              setPending(null);
              setPolicySaved(false);
              setRevision((n) => n + 1);
              await onRefresh?.();
            }
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Your policy is saved. Retry the card upload.",
            );
          } finally {
            setUploading(false);
          }
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
        <div className="insurance-card-tools">
          {!readOnly && (
            <button
              type="button"
              className="btn"
              disabled={locked}
              onClick={() => setScanner(true)}
            >
              <Camera size={17} /> Scan insurance card
            </button>
          )}
          {pending && (
            <span className="business-review-banner">
              {policySaved
                ? "Policy saved · card upload pending"
                : "Reviewed card ready · save insurance to attach it"}
            </span>
          )}
          {card && (
            <a
              className="btn"
              href={insuranceImageUrl(card, demo)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View saved insurance card
            </a>
          )}
          {card && (
            <span className="muted-copy">Available with the sold pack.</span>
          )}
          {cardError && (
            <span role="alert">
              {cardError}{" "}
              <button
                type="button"
                className="text-btn"
                onClick={() => setRevision((n) => n + 1)}
              >
                Retry
              </button>
            </span>
          )}
        </div>
        <div className="form-grid">
          {fields.map(([k, l, t]) => (
            <label key={k}>
              {l}
              <input
                type={t}
                value={v[k] ?? ""}
                readOnly={readOnly || locked}
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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          <button className="btn primary" disabled={busy || uploading}>
            {uploading
              ? "Saving…"
              : policySaved
                ? "Retry insurance card upload"
                : "Save insurance"}
          </button>
        )}
      </form>
      {scanner && (
        <InsuranceScanner
          initial={v}
          vehicleVin={vehicleVin}
          onClose={() => setScanner(false)}
          onScan={(insurance, capture) => {
            setV(insurance);
            setPending(capture);
            setError("");
            setScanner(false);
          }}
        />
      )}
    </>
  );
}
