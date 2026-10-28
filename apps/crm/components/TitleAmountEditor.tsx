"use client";
import { useState, type FormEvent } from "react";
import { Modal } from "./ui";
import { commandSchema, type Workspace, type Command } from "../lib/model";
import { titleAmounts } from "../lib/title-clerk-money";
import type { TitleCase } from "../lib/title-clerk";

export function TitleAmountEditor({
  ws,
  record,
  run,
  onClose,
}: {
  ws: Workspace;
  record: TitleCase;
  run: (command: Command, message?: string) => Promise<{ ok: boolean }>;
  onClose: () => void;
}) {
  const current = titleAmounts(ws, record);
  const [fees, setFees] = useState(
    current.fees === null ? "" : current.fees.toFixed(2),
  );
  const [taxes, setTaxes] = useState(
    current.taxes === null ? "" : current.taxes.toFixed(2),
  );
  const [note, setNote] = useState("");
  const [revision] = useState(record.revision);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const stale = record.revision !== revision;
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!fees.trim() || !taxes.trim()) {
      setError(
        "Enter both DMV fees and taxes. Use 0 only when no amount is due.",
      );
      return;
    }
    const parsed = commandSchema.safeParse({
      type: "save_title_amounts",
      id: record.id,
      revision,
      values: { fees: Number(fees), taxes: Number(taxes), note },
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message || "Check the amounts and reason.",
      );
      return;
    }
    setSaving(true);
    try {
      if ((await run(parsed.data, "DMV amounts saved to this title file")).ok)
        onClose();
    } catch {
      setError("Unable to save DMV amounts. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Review DMV amounts"
      subtitle={record.customer_name}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className="tc-amount-editor" onSubmit={save}>
        <p>
          Enter the fees and taxes required for this title file. Include
          highway-use tax and any other verified taxes.
        </p>
        <div className="form-grid">
          <label>
            DMV fees ($)
            <input
              aria-label="DMV fees to track"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              disabled={saving}
            />
          </label>
          <label>
            Taxes ($)
            <input
              aria-label="Taxes to track"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
              value={taxes}
              onChange={(e) => setTaxes(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <label>
          Reason / verification notes
          <textarea
            aria-label="DMV amount review notes"
            required
            minLength={3}
            maxLength={1000}
            rows={3}
            placeholder="Explain the correction, or why a zero amount is correct."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
          />
        </label>
        <p className="fine-print">
          This updates title tracking and records the change in History.
          Customer charges and previously printed paperwork are unchanged;
          review the bill of sale separately if those also need correction.
        </p>
        {(error || stale) && (
          <p className="form-error" role="alert">
            {stale
              ? "This title file changed. Close and reopen the review before saving."
              : error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="submit"
            disabled={saving || stale}
          >
            {saving ? "Saving…" : "Save DMV amounts"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
