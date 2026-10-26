"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";

export function DeleteVehicle({
  label,
  linked,
  blocked,
  busy,
  onDelete,
}: {
  label: string;
  linked?: boolean;
  blocked?: string;
  busy: boolean;
  onDelete: (reason: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false),
    [reason, setReason] = useState("");
  return (
    <section className="delete-vehicle">
      {confirm ? (
        <>
          <h3>Delete {label}?</h3>
          <p>
            This removes the vehicle from the current list
            {linked ? " and its linked retail inventory" : ""}. Saved deal
            history and accounting are retained. This cannot be undone from this
            screen.
          </p>
          <label>
            Reason for deletion
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              placeholder="Duplicate entry, entered by mistake…"
            />
          </label>
          <div className="delete-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                if (await onDelete(reason.trim())) setConfirm(false);
              }}
            >
              <Trash2 size={15} /> Confirm deletion
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn danger small"
            disabled={busy || !!blocked}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} /> Delete {label}
          </button>
          {blocked && <p>{blocked}</p>}
        </>
      )}
    </section>
  );
}
