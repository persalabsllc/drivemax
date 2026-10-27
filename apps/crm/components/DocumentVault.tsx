"use client";
import { useEffect, useMemo, useState } from "react";
import { completeDocument } from "../lib/document-upload";
import {
  Archive,
  Search,
  Upload,
  ShieldCheck,
  FileText,
  Car,
  Users,
  Download,
  ExternalLink,
  ArrowUpRight,
  CalendarClock,
  FolderLock,
} from "lucide-react";
import {
  canManage,
  myStaffId,
  type Workspace,
  type Customer,
} from "../lib/model";
import type { DealFile } from "../lib/sales-work";
import { vehicleName } from "../lib/vehicles";
import {
  documentKinds,
  documentMatches,
  fileSize,
} from "../lib/vault-documents";
import { DocumentUpload } from "./DocumentUpload";
import { Modal, Empty } from "./ui";
const dateLabel = (v?: string) =>
  v
    ? new Date(v.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      })
    : "—";
export function DocumentVault({
  ws,
  demo,
  onRefresh,
  onCustomer,
}: {
  ws: Workspace;
  demo: boolean;
  onRefresh: () => Promise<void>;
  onCustomer: (c: Customer, opportunity?: string | null) => void;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [scope, setScope] = useState("all"),
    [from, setFrom] = useState(""),
    [through, setThrough] = useState(""),
    [limit, setLimit] = useState(50),
    [upload, setUpload] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [selected, setSelected] = useState<DealFile | null>(null);
  const [mode, setMode] = useState(
      canManage(ws.member.role) ? "stock" : "customer",
    ),
    [vehicleQuery, setVehicleQuery] = useState(""),
    [inventory, setInventory] = useState(""),
    [customer, setCustomer] = useState(""),
    [opportunity, setOpportunity] = useState("");
  const manager = canManage(ws.member.role),
    staffId = myStaffId(ws),
    files = ws.deal_files ?? [];
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]),
    [retrying, setRetrying] = useState(""),
    [pendingError, setPendingError] = useState("");
  useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/documents")
      .then((r) => r.json())
      .then((v) => {
        if (active && Array.isArray(v.files)) setPending(v.files);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [demo, files.length, upload]);
  async function retryPending(id: string) {
    setRetrying(id);
    setPendingError("");
    try {
      await completeDocument(id);
      setPending((p) => p.filter((f) => f.id !== id));
      await onRefresh();
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : "Please retry filing.");
    } finally {
      setRetrying("");
    }
  }
  const searchNames = useMemo(() => {
    const customerNames = new Map(ws.customers.map((c) => [c.id, c.name]));
    const inventoryNames = new Map<string, Set<string>>();
    for (const o of ws.opportunities) {
      if (!o.inventory_id) continue;
      const names = inventoryNames.get(o.inventory_id) ?? new Set<string>();
      names.add(customerNames.get(o.customer_id) ?? "");
      inventoryNames.set(o.inventory_id, names);
    }
    return { customerNames, inventoryNames };
  }, [ws.customers, ws.opportunities]);
  const rows = useMemo(
    () =>
      files
        .filter((f) => {
          const current = f.customer_id
            ? (searchNames.customerNames.get(f.customer_id) ?? "")
            : Array.from(
                searchNames.inventoryNames.get(f.inventory_id ?? "") ?? [],
              ).join(" ");
          return (
            documentMatches(f, query, current) &&
            (kind === "all" || f.kind === kind) &&
            (scope === "all" ||
              (scope === "stock" ? !f.customer_id : !!f.customer_id)) &&
            (!from || (f.document_date ?? f.created_at.slice(0, 10)) >= from) &&
            (!through ||
              (f.document_date ?? f.created_at.slice(0, 10)) <= through)
          );
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [files, searchNames, query, kind, scope, from, through],
  );
  const customers = ws.customers
    .filter(
      (c) =>
        manager ||
        ws.opportunities.some(
          (o) => o.customer_id === c.id && o.assigned_to === staffId,
        ),
    )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const opportunities = ws.opportunities.filter(
    (o) => o.customer_id === customer && (manager || o.assigned_to === staffId),
  );
  const vehicles = ws.inventory.filter((v) =>
    [v.stock_number, v.vin, vehicleName(v)]
      .join(" ")
      .toLowerCase()
      .includes(vehicleQuery.toLowerCase()),
  );
  const target = ws.inventory.find((v) => v.id === inventory),
    opp = opportunities.find((o) => o.id === opportunity);
  function exportIndex() {
    const escape = (v: unknown) =>
      `"${String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const data = [
      [
        "File",
        "Type",
        "Customer",
        "Stock",
        "VIN",
        "Vehicle",
        "Document date",
        "Uploaded",
        "Retain through",
        "SHA-256",
        "Notes",
      ],
      ...rows.map((f) => [
        f.name,
        documentKinds[f.kind as keyof typeof documentKinds] ?? f.kind,
        f.customer_name,
        f.stock_number,
        f.vin,
        f.vehicle_label,
        f.document_date,
        f.created_at,
        f.retain_until,
        f.sha256,
        f.notes,
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
        new Blob(["\ufeff" + data], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "Drive-Max-Document-Index.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="document-vault">
      <section className="vault-hero">
        <div className="vault-hero-copy">
          <span className="vault-eyebrow">
            <FolderLock size={15} /> DRIVE MAX DOCUMENT VAULT
          </span>
          <h2>
            Every document.
            <br />
            Right where you need it.
          </h2>
          <p>
            Customer paperwork, titles and vehicle records — organized together,
            easy to find.
          </p>
          <button
            className="btn vault-upload-button"
            onClick={() => setUpload(true)}
          >
            <Upload size={17} />
            Upload documents
          </button>
        </div>
        <div className="vault-seal">
          <ShieldCheck size={36} />
          <strong>7 years</strong>
          <span>Minimum retention</span>
          <small>Private files · Original copies</small>
        </div>
      </section>
      <div className="vault-stats">
        <div>
          <span className="vault-stat-icon blue">
            <Archive size={20} />
          </span>
          <div>
            <strong>{files.length}</strong>
            <span>Stored documents</span>
          </div>
        </div>
        <div>
          <span className="vault-stat-icon purple">
            <Users size={20} />
          </span>
          <div>
            <strong>
              {new Set(files.map((f) => f.customer_id).filter(Boolean)).size}
            </strong>
            <span>Customer files</span>
          </div>
        </div>
        <div>
          <span className="vault-stat-icon teal">
            <Car size={20} />
          </span>
          <div>
            <strong>
              {
                new Set(
                  files.map((f) => f.vin || f.stock_number).filter(Boolean),
                ).size
              }
            </strong>
            <span>Vehicles on file</span>
          </div>
        </div>
      </div>
      {!!pending.length && (
        <section className="panel vault-recovery">
          <h2>Finish filing recent uploads</h2>
          <p>
            These originals uploaded successfully but still need to be added to
            the index.
          </p>
          {pending.map((f) => (
            <div className="vault-pending" key={f.id}>
              <span>{f.name}</span>
              <button
                className="btn small"
                disabled={!!retrying}
                onClick={() => void retryPending(f.id)}
              >
                {retrying === f.id ? "Filing…" : "Finish filing"}
              </button>
            </div>
          ))}
          {pendingError && (
            <p role="alert" className="vault-error">
              {pendingError}
            </p>
          )}
        </section>
      )}
      <section className="panel vault-library">
        <div className="vault-section-title">
          <div>
            <h2>
              <Search size={18} />
              Find your paperwork
            </h2>
            <p>Search names, stock numbers, VINs, filenames and notes.</p>
          </div>
          <button
            className="btn small"
            disabled={!rows.length}
            onClick={exportIndex}
          >
            <Download size={14} />
            Export index
          </button>
        </div>
        <label className="vault-search">
          <Search size={19} />
          <input
            aria-label="Search vault"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(50);
            }}
            placeholder="Customer, stock #, VIN or document name…"
          />
        </label>
        <div className="vault-filters">
          <label>
            Document type
            <select
              aria-label="Filter document type"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setLimit(50);
              }}
            >
              <option value="all">All document types</option>
              {Object.entries(documentKinds).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filed under
            <select
              aria-label="Filed under"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setLimit(50);
              }}
            >
              <option value="all">All records</option>
              <option value="customer">Customers & deals</option>
              <option value="stock">Inventory only</option>
            </select>
          </label>
          <label>
            Document date from
            <input
              aria-label="Document date from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Through
            <input
              aria-label="Document date through"
              type="date"
              value={through}
              onChange={(e) => setThrough(e.target.value)}
            />
          </label>
          <button
            className="text-btn"
            onClick={() => {
              setQuery("");
              setKind("all");
              setScope("all");
              setFrom("");
              setThrough("");
              setLimit(50);
            }}
          >
            Reset
          </button>
        </div>
        <div className="vault-results-label">
          <span>
            {rows.length} document{rows.length === 1 ? "" : "s"} found
          </span>
          <span>Newest uploads first</span>
        </div>
        <div className="vault-file-list">
          {rows.slice(0, limit).map((f) => (
            <article
              className={`vault-file ${f.customer_id ? "customer" : "stock"}`}
              key={f.id}
            >
              <button
                className="vault-file-main"
                onClick={() => setSelected(f)}
              >
                <span className="vault-file-icon">
                  <FileText size={22} />
                </span>
                <div>
                  <strong>{f.name}</strong>
                  <span>
                    {f.customer_name || "Inventory record"}
                    {f.stock_number && (
                      <>
                        {" "}
                        · <b>#{f.stock_number}</b>
                      </>
                    )}
                  </span>
                  <small>
                    {f.vehicle_label || "Customer paperwork"}
                    {f.vin && <> · {f.vin}</>}
                  </small>
                  <span className="vault-file-tags">
                    <em>
                      {documentKinds[f.kind as keyof typeof documentKinds] ??
                        f.kind}
                    </em>
                    <small>
                      {fileSize(f.size)} ·{" "}
                      {dateLabel(f.document_date ?? f.created_at)}
                    </small>
                  </span>
                </div>
              </button>
              <div className="vault-file-actions">
                <a
                  className="btn small"
                  href={`/api/deal-files/${f.id}?view=inline`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  View
                </a>
                <a
                  className="icon-btn"
                  href={`/api/deal-files/${f.id}`}
                  aria-label={`Download ${f.name}`}
                >
                  <Download size={17} />
                </a>
              </div>
            </article>
          ))}
        </div>
        {!rows.length && (
          <Empty
            title={
              files.length
                ? "No documents match those filters."
                : "Your filing cabinet is ready."
            }
            body={
              files.length
                ? "Try a name, stock number, VIN or a different date range."
                : "Upload a scanned packet or vehicle document. Files saved from customer profiles also appear here."
            }
            action={
              <button
                className="btn"
                onClick={() =>
                  files.length
                    ? (setQuery(""),
                      setKind("all"),
                      setScope("all"),
                      setFrom(""),
                      setThrough(""))
                    : setUpload(true)
                }
              >
                {files.length ? "Clear filters" : "Upload your first document"}
              </button>
            }
          />
        )}
        {rows.length > limit && (
          <button
            className="btn vault-more"
            onClick={() => setLimit((l) => l + 50)}
          >
            Show more documents
          </button>
        )}
      </section>
      <p className="vault-retention-note">
        <ShieldCheck size={15} />
        Files are retained for at least seven years from upload, document date
        or a later linked sale. Nothing is automatically deleted when that date
        arrives.
      </p>
      {upload && (
        <Modal
          title="File documents in the vault"
          subtitle="Attach originals to a stock number or customer record."
          wide
          onClose={() => {
            if (!uploadBusy) setUpload(false);
          }}
        >
          <div className="vault-dialog">
            <fieldset className="vault-link-fields" disabled={uploadBusy}>
              {manager && (
                <div className="segmented vault-mode">
                  <button
                    className={mode === "stock" ? "active" : ""}
                    onClick={() => setMode("stock")}
                  >
                    <Car size={15} />
                    Stock number
                  </button>
                  <button
                    className={mode === "customer" ? "active" : ""}
                    onClick={() => setMode("customer")}
                  >
                    <Users size={15} />
                    Customer / deal
                  </button>
                </div>
              )}
              {mode === "stock" ? (
                <>
                  <label>
                    Find vehicle
                    <input
                      aria-label="Find vehicle for documents"
                      value={vehicleQuery}
                      onChange={(e) => setVehicleQuery(e.target.value)}
                      placeholder="Stock number, VIN, year, make or model"
                    />
                  </label>
                  <label>
                    Attach to stock number
                    <select
                      aria-label="Attach to stock number"
                      value={inventory}
                      onChange={(e) => setInventory(e.target.value)}
                    >
                      <option value="">Choose an inventory vehicle…</option>
                      {(target && !vehicles.some((v) => v.id === target.id)
                        ? [target, ...vehicles]
                        : vehicles
                      ).map((v) => (
                        <option key={v.id} value={v.id}>
                          #{v.stock_number} · {vehicleName(v)} ·{" "}
                          {v.status.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  {target && (
                    <div className="vault-attachment">
                      <Car size={20} />
                      <div>
                        <strong>
                          #{target.stock_number} · {vehicleName(target)}
                        </strong>
                        <span>VIN {target.vin}</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="vault-form-grid">
                  <label>
                    Customer
                    <select
                      aria-label="Document customer"
                      value={customer}
                      onChange={(e) => {
                        setCustomer(e.target.value);
                        setOpportunity("");
                      }}
                    >
                      <option value="">Choose customer…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.email || c.phone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Opportunity
                    <select
                      aria-label="Document opportunity"
                      value={opportunity}
                      onChange={(e) => setOpportunity(e.target.value)}
                    >
                      <option value="">
                        {manager
                          ? "General customer paperwork"
                          : "Choose assigned opportunity…"}
                      </option>
                      {opportunities.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title} · {o.status} ·{" "}
                          {o.vehicle_interest || "No vehicle"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {opp && (
                    <p className="vault-attachment">
                      <Car size={18} />
                      {opp.vehicle_interest || "No vehicle attached"} · Vehicle
                      details are captured when filed.
                    </p>
                  )}
                </div>
              )}
            </fieldset>
            <DocumentUpload
              onBusy={setUploadBusy}
              metadata={{
                customer_id: mode === "customer" ? customer || null : null,
                opportunity_id:
                  mode === "customer" ? opportunity || null : null,
                inventory_id: mode === "stock" ? inventory || null : null,
              }}
              disabled={
                mode === "stock"
                  ? !inventory
                  : !customer || (!manager && !opportunity)
              }
              demo={demo}
              onRefresh={onRefresh}
            />
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title="Document details"
          subtitle={selected.name}
          wide
          onClose={() => setSelected(null)}
        >
          <div className="vault-dialog">
            <div className="vault-detail-banner">
              <FileText size={30} />
              <div>
                <strong>{selected.name}</strong>
                <span>
                  {documentKinds[selected.kind as keyof typeof documentKinds] ??
                    selected.kind}{" "}
                  · {fileSize(selected.size)}
                </span>
              </div>
            </div>
            <dl className="vault-details">
              {[
                ["Customer", selected.customer_name || "Inventory record"],
                ["Stock number", selected.stock_number || "—"],
                ["Vehicle", selected.vehicle_label || "—"],
                ["VIN", selected.vin || "—"],
                ["Document date", dateLabel(selected.document_date)],
                ["Uploaded", dateLabel(selected.created_at)],
                [
                  "Uploaded by",
                  ws.staff.find((s) => s.user_id === selected.created_by)
                    ?.name || "Team member",
                ],
                ["Retain through", dateLabel(selected.retain_until)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {selected.notes && (
              <p className="vault-document-notes">{selected.notes}</p>
            )}
            <div className="vault-detail-footer">
              <span>
                <CalendarClock size={16} />
                Original archived file
              </span>
              <div className="ops-actions">
                {selected.customer_id && (
                  <button
                    className="btn"
                    onClick={() => {
                      const c = ws.customers.find(
                        (c) => c.id === selected.customer_id,
                      );
                      if (c) {
                        setSelected(null);
                        onCustomer(c, selected.opportunity_id);
                      }
                    }}
                  >
                    Customer profile
                    <ArrowUpRight size={15} />
                  </button>
                )}
                <a
                  className="btn"
                  href={`/api/deal-files/${selected.id}?view=inline`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} />
                  View document
                </a>
                <a
                  className="btn primary"
                  href={`/api/deal-files/${selected.id}`}
                >
                  <Download size={15} />
                  Download original
                </a>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
