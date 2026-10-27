"use client";
import { useRef, useState } from "react";
import { Upload, FileCheck2, AlertCircle, RotateCcw } from "lucide-react";
import {
  documentKinds,
  fileSize,
  type DocumentMetadata,
} from "../lib/vault-documents";
import {
  uploadDocument,
  completeDocument,
  PendingDocumentError,
} from "../lib/document-upload";
import { dayKey } from "../lib/model";
export function DocumentUpload({
  metadata,
  demo = false,
  disabled = false,
  onRefresh,
  onBusy,
}: {
  metadata: Pick<
    DocumentMetadata,
    "customer_id" | "opportunity_id" | "inventory_id"
  >;
  demo?: boolean;
  disabled?: boolean;
  onRefresh?: () => Promise<void>;
  onBusy?: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [kind, setKind] = useState<keyof typeof documentKinds>("signed"),
    [date, setDate] = useState(dayKey()),
    [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [message, setMessage] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  async function upload() {
    if (demo) {
      setErrors([
        "Uploads are available in the live workspace. Demo files are not stored.",
      ]);
      return;
    }
    setBusy(true);
    onBusy?.(true);
    setErrors([]);
    setMessage("");
    let saved = 0;
    const failed: File[] = [];
    const problems: string[] = [];
    // Capture links before awaiting, so changing the selection cannot split a batch.
    const links = { ...metadata, kind, document_date: date, notes };
    for (const [index, file] of files.entries())
      try {
        await uploadDocument(file, links, (s) =>
          setStage(`${index + 1} / ${files.length} · ${s}`),
        );
        saved++;
      } catch (e) {
        if (e instanceof PendingDocumentError) {
          setPending((p) => [...p, { id: e.id, name: file.name }]);
          problems.push(
            `${file.name}: uploaded but filing needs another attempt. Use Retry filing below.`,
          );
        } else {
          failed.push(file);
          problems.push(
            `${file.name}: ${e instanceof Error ? e.message : "Upload failed."}`,
          );
        }
      }
    setFiles(failed);
    if (input.current) input.current.value = "";
    setErrors(problems);
    setStage("");
    if (saved) {
      setMessage(
        `${saved} document${saved === 1 ? "" : "s"} filed in the vault.`,
      );
      try {
        await onRefresh?.();
      } catch {
        setErrors((p) => [
          ...p,
          "Files were saved. Refresh the workspace to see them.",
        ]);
      }
    }
    setBusy(false);
    onBusy?.(false);
  }
  async function retry(id: string) {
    setBusy(true);
    onBusy?.(true);
    setErrors([]);
    try {
      await completeDocument(id);
      setPending((p) => p.filter((f) => f.id !== id));
      setMessage("Document filed in the vault.");
      await onRefresh?.();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not finish filing."]);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <div className="document-upload">
      <fieldset disabled={busy || disabled}>
        <div className="vault-form-grid">
          <label>
            Document type
            <select
              aria-label="Document type"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {Object.entries(documentKinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Document date
            <input
              aria-label="Document date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label>
          Notes <span className="vault-optional">(optional)</span>
          <input
            aria-label="Document notes"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Title received, lender packet, repair invoice…"
          />
        </label>
        <label className="vault-drop">
          <Upload size={26} />
          <strong>Choose scanned documents</strong>
          <span>PDF, JPG or PNG · up to 25 MB each · 20 files per upload</span>
          <input
            ref={input}
            aria-label="Choose documents"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length > 20) {
                setErrors(["Choose up to 20 files at a time."]);
                setFiles([]);
                return;
              }
              setFiles(selected);
              setErrors([]);
              setMessage("");
            }}
          />
        </label>
        {!!files.length && (
          <ul className="vault-upload-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <FileCheck2 size={15} />
                <span>{f.name}</span>
                <small>{fileSize(f.size)}</small>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {errors.map((e, i) => (
        <p className="vault-error" role="alert" key={i}>
          <AlertCircle size={16} />
          {e}
        </p>
      ))}
      {pending.map((f) => (
        <div className="vault-pending" key={f.id}>
          <span>{f.name}</span>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void retry(f.id)}
          >
            <RotateCcw size={14} />
            Retry filing
          </button>
        </div>
      ))}
      {message && (
        <p className="vault-success" role="status">
          <FileCheck2 size={17} />
          {message}
        </p>
      )}
      <div className="vault-upload-footer">
        <small>
          Original files are retained. New uploads create separate records.
        </small>
        <button
          className="btn primary"
          disabled={disabled || busy || !files.length || !date}
          onClick={() => void upload()}
        >
          <Upload size={16} />
          {busy
            ? stage || "Filing…"
            : `File ${files.length > 1 ? `${files.length} documents` : "document"}`}
        </button>
      </div>
    </div>
  );
}
