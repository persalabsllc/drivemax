"use client";
import { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Upload,
  Download,
  Save,
  ExternalLink,
} from "lucide-react";
import {
  canManage,
  type Workspace,
  type Opportunity,
  type Command,
} from "../lib/model";
import {
  emptyProgress,
  progressSchema,
  salesStages,
  fundingStages,
  deliveryChecks,
} from "../lib/sales-work";
import { SectionTitle } from "./ui";
export function DealDelivery({
  ws,
  opportunity: o,
  run,
  busy,
  demo,
  onRefresh,
}: {
  ws: Workspace;
  opportunity: Opportunity;
  run: (p: Command, message?: string) => Promise<{ ok: boolean }>;
  busy: boolean;
  demo: boolean;
  onRefresh?: () => Promise<void>;
}) {
  const saved = ws.deal_progress?.find((p) => p.id === o.id);
  const [draft, setDraft] = useState<typeof emptyProgress>(
    () =>
      saved ?? {
        ...emptyProgress,
        stage:
          o.status === "new"
            ? ("new" as const)
            : o.status === "appointment"
              ? ("appointment" as const)
              : ("contacted" as const),
      },
  );
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState("signed");
  const [file, setFile] = useState<File | null>(null);
  const patch = (values: Partial<typeof draft>) =>
    setDraft({ ...draft, ...values });
  const checks = deliveryChecks(ws, o);
  const manager = canManage(ws.member.role);
  async function upload() {
    if (!file) return;
    if (demo) {
      setError(
        "Uploads are available in the live workspace. Demo files are not stored.",
      );
      return;
    }
    setUploading(true);
    setError("");
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("customer_id", o.customer_id);
      data.set("opportunity_id", o.id);
      data.set("kind", kind);
      const r = await fetch("/api/deal-files", { method: "POST", body: data });
      const result = await r.json();
      if (!r.ok) throw Error(result.error || "Upload failed");
      setFile(null);
      await onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <section className="profile-work-section">
      <SectionTitle
        title="Deal progress & delivery"
        subtitle="Keep the next step, funding requirements, and delivery documents together."
      />
      <div className="form-grid">
        <label>
          Sales stage
          <select
            value={draft.stage}
            onChange={(e) =>
              patch({ stage: e.target.value as typeof draft.stage })
            }
          >
            {Object.entries(salesStages).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Funding status
          <select
            disabled={!manager}
            value={draft.funding}
            onChange={(e) =>
              patch({ funding: e.target.value as typeof draft.funding })
            }
          >
            {Object.entries(fundingStages).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lender
          <input
            disabled={!manager}
            value={draft.lender}
            onChange={(e) => patch({ lender: e.target.value })}
          />
        </label>
        <label>
          Funded on
          <input
            type="date"
            disabled={!manager}
            value={draft.funded_on}
            onChange={(e) => patch({ funded_on: e.target.value })}
          />
        </label>
      </div>
      <label>
        Outstanding stipulations
        <textarea
          disabled={!manager}
          value={draft.stipulations}
          onChange={(e) => patch({ stipulations: e.target.value })}
          placeholder="Proof of income, proof of residence, insurance binder…"
        />
      </label>
      <label>
        Secure credit application link
        <input
          type="url"
          placeholder="https://…"
          value={draft.credit_url}
          onChange={(e) => patch({ credit_url: e.target.value })}
        />
      </label>
      {draft.credit_url.startsWith("https://") && (
        <a
          className="btn small"
          href={draft.credit_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} />
          Open application provider
        </a>
      )}
      <p className="work-note">
        Application submissions and lender decisions are recorded here by staff.
        This does not submit an application to a lender.
      </p>
      <h3>Before you print</h3>
      <div className="delivery-checks">
        {checks.map((c) => (
          <div key={c.key} className={c.ready ? "ready" : "missing"}>
            {c.ready ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{c.label}</span>
            <strong>{c.ready ? "Present" : "Needs review"}</strong>
          </div>
        ))}
      </div>
      <h3>Delivery checklist</h3>
      {[
        ["identity", "Buyer / co-buyer identification reviewed"],
        ["insurance", "Insurance verified"],
        ["trade", "Trade title, lienholder and payoff verified"],
        ["products", "Products and terms accepted or declined"],
        ["funds", "Funds / lender requirements cleared"],
        ["odometer", "Odometer and disclosures reviewed"],
        ["signatures", "Required signatures and copies complete"],
        ["keys", "Keys, vehicle condition and delivery reviewed"],
      ].map(([k, label]) => (
        <label className="check-line" key={k}>
          <input
            type="checkbox"
            checked={draft.delivery[k] ?? false}
            onChange={(e) =>
              patch({ delivery: { ...draft.delivery, [k]: e.target.checked } })
            }
          />
          {label}
        </label>
      ))}
      <label>
        Delivery notes
        <textarea
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </label>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          const p = progressSchema.safeParse(draft);
          if (!p.success) {
            setError(p.error.issues[0].message);
            return;
          }
          const result = await run(
            {
              type: "save_deal_progress",
              id: o.id,
              revision: saved?.revision ?? 0,
              progress: p.data,
            },
            "Deal progress saved",
          );
          if (result.ok) setError("");
        }}
      >
        <Save size={15} />
        Save deal progress
      </button>
      <div className="deal-files">
        <SectionTitle
          title="Deal file"
          subtitle="Signed paperwork, insurance, and finalized print packets. PDF, JPG or PNG up to 4 MB."
        />
        <div className="form-grid">
          <label>
            Document type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {[
                ["signed", "Signed paperwork"],
                ["insurance", "Insurance"],
                ["identification", "Identification"],
                ["stipulation", "Lender stipulation"],
                ["other", "Other"],
              ].map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          className="btn"
          disabled={!file || uploading || busy}
          onClick={upload}
        >
          <Upload size={15} />
          {uploading ? "Uploading…" : "Upload document"}
        </button>
        {(ws.deal_files ?? [])
          .filter((f) => f.opportunity_id === o.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((f) => (
            <div className="deal-file" key={f.id}>
              <span>
                <strong>{f.name}</strong>
                <small>
                  {f.kind} · {Math.ceil(f.size / 1024)} KB ·{" "}
                  {new Date(f.created_at).toLocaleDateString()}
                </small>
              </span>
              <a
                className="btn small"
                href={`/api/deal-files/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download size={14} />
                Download
              </a>
            </div>
          ))}
      </div>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
