"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ImagePlus, RotateCw } from "lucide-react";
import { Modal } from "./ui";
import { prepareCardPhoto } from "../lib/card-photo";
import { readInsuranceCard } from "../lib/insurance-ocr";
import { insuranceSchema, type Insurance } from "../lib/people";
import type { InsuranceCapture } from "../lib/insurance-scan";
export default function InsuranceScanner({
  initial,
  vehicleVin,
  onScan,
  onClose,
}: {
  initial: Insurance;
  vehicleVin?: string;
  onScan: (insurance: Insurance, capture: InsuranceCapture) => void;
  onClose: () => void;
}) {
  const operation = useRef<AbortController | null>(null),
    original = useRef<File | null>(null),
    rotation = useRef(0);
  const [photo, setPhoto] = useState<File | null>(null),
    [url, setUrl] = useState(""),
    [value, setValue] = useState(initial),
    [working, setWorking] = useState(false),
    [progress, setProgress] = useState(0),
    [warnings, setWarnings] = useState<string[]>([]),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!photo) return;
    const u = URL.createObjectURL(photo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  async function scan(file: File, turn = 0) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    original.current = file;
    rotation.current = turn;
    setWorking(true);
    setProgress(0);
    setError("");
    setWarnings([]);
    setReviewed(false);
    setPhoto(null);
    try {
      const prepared = await prepareCardPhoto(
        file,
        controller.signal,
        turn,
        "insurance card",
      );
      setPhoto(prepared.file);
      const result = await readInsuranceCard(
        prepared.file,
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted) return;
      setValue({ ...initial, ...result.suggestions });
      setWarnings([
        ...result.warnings,
        ...(result.vin && vehicleVin && result.vin !== vehicleVin.toUpperCase()
          ? [
              "The VIN read from this card does not match the selected vehicle. Check the card before saving.",
            ]
          : []),
      ]);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : "The card could not be read. Enter the policy details below.",
        );
        setValue(initial);
      }
    } finally {
      if (!controller.signal.aborted) setWorking(false);
    }
  }
  const close = () => {
    operation.current?.abort();
    onClose();
  };
  return createPortal(
    <Modal
      title="Scan insurance card"
      subtitle="Photograph the whole card in good light, with the text upright."
      onClose={close}
      className="insurance-scanner"
    >
      <div className="modal-form">
        <div className="insurance-photo-actions">
          <label className="btn primary">
            <Camera size={17} /> Take card photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={working}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void scan(f);
              }}
            />
          </label>
          <label className="btn">
            <ImagePlus size={17} /> Choose photo
            <input
              type="file"
              accept="image/*"
              disabled={working}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void scan(f);
              }}
            />
          </label>
        </div>
        <p className="muted-copy">
          Text is read on this device. Review the card before saving; scanning
          does not confirm insurance coverage.
        </p>
        {url && photo && (
          <img
            className="insurance-card-preview"
            src={url}
            alt="Insurance card to review"
          />
        )}
        {working ? (
          <div role="status" className="insurance-scan-progress">
            <progress max={100} value={progress} />
            <span>
              {progress
                ? `Reading policy details… ${progress}%`
                : "Preparing the card reader…"}
            </span>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                operation.current?.abort();
                setWorking(false);
                setError(
                  "Scan stopped. You can enter the policy details manually or choose another photo.",
                );
              }}
            >
              Stop scan
            </button>
          </div>
        ) : (
          photo && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (original.current)
                  void scan(original.current, (rotation.current + 90) % 360);
              }}
            >
              <RotateCw size={16} /> Rotate & read again
            </button>
          )
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!!warnings.length && (
          <div className="business-review-banner">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        {photo && !working && (
          <>
            <div className="form-grid">
              {(
                [
                  ["company", "Insurance company", "text"],
                  ["policy_number", "Policy number", "text"],
                  ["effective_from", "Effective date", "date"],
                  ["effective_to", "Expiration date", "date"],
                ] as const
              ).map(([key, label, type]) => (
                <label key={key}>
                  {label}
                  <input
                    type={type}
                    maxLength={250}
                    value={value[key]}
                    onChange={(e) => {
                      setValue({ ...value, [key]: e.target.value });
                      setReviewed(false);
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />{" "}
              I reviewed the policy details and the card photo is readable.
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={!reviewed}
              onClick={() => {
                const parsed = insuranceSchema.safeParse(value);
                if (!parsed.success) {
                  setError(parsed.error.issues[0].message);
                  return;
                }
                onScan(parsed.data, { id: crypto.randomUUID(), file: photo });
              }}
            >
              Use card & review insurance
            </button>
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
