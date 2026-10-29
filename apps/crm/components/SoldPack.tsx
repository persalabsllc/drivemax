"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { deliveryChecks } from "../lib/sales-work";
import {
  Download,
  Printer,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Opportunity,
  type Command,
  opportunityOpen,
} from "../lib/model";
import {
  documentContext,
  fieldKey,
  formValues,
  soldPackForms,
  selectedPrintForms,
  type SoldPackVariant,
  mvr2Form,
  sharedPrintFields,
  type FormTemplate,
  type Paperwork,
  type PaperValues,
  type FormField,
} from "../lib/documents";
import { uploadDocument } from "../lib/document-upload";
import { dayKey } from "../lib/model";
import { buildSoldPack, buildMvr2 } from "../lib/pdf-output";
import { appendLicenseCopies } from "../lib/license-print";
import {
  customerLicense,
  licenseImageUrl,
} from "../lib/customer-license-client";
import type { SavedLicense } from "../lib/license-scan";
import { titleFormCatalog } from "../lib/title-form-catalog";
const cache = new Map<string, Promise<Uint8Array>>();
function template(f: FormTemplate) {
  let p = cache.get(f.id);
  if (!p) {
    p = fetch("/api/forms/" + encodeURIComponent(f.id))
      .then(async (r) => {
        if (!r.ok) throw new Error("Unable to load " + f.title);
        return new Uint8Array(await r.arrayBuffer());
      })
      .catch((e) => {
        cache.delete(f.id);
        throw e;
      });
    cache.set(f.id, p);
  }
  return p.then((b) => b.slice());
}
function PdfPage({
  form,
  values,
  onField,
  section,
  pageIndex,
}: {
  form: FormTemplate;
  values: PaperValues;
  onField: (f: FormField, v: string | boolean) => void;
  section: number;
  pageIndex: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    page = form.pages[pageIndex];
  useEffect(() => {
    let canceled = false;
    let cleanup: (() => void) | undefined;
    setReady(false);
    setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({
        data: await template(form),
        standardFontDataUrl: "/pdf-standard-fonts/",
      });
      cleanup = () => {
        void task.destroy();
      };
      const pdf = await task.promise;
      if (canceled) return;
      const p = await pdf.getPage(pageIndex + 1),
        viewport = p.getViewport({ scale: 1.75 }),
        el = canvas.current;
      if (!el || canceled) return;
      el.width = viewport.width;
      el.height = viewport.height;
      await p.render({
        canvas: el,
        viewport,
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      }).promise;
      if (!canceled) setReady(true);
    })().catch((e) => {
      if (!canceled)
        setError(
          e instanceof Error ? e.message : "Unable to display this form.",
        );
    });
    return () => {
      canceled = true;
      cleanup?.();
    };
  }, [form, pageIndex]);
  return (
    <div className="pdf-preview-wrap">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!ready && !error && <p className="pdf-loading">Loading {form.title}…</p>}
      <div
        className="pdf-sheet"
        style={{ aspectRatio: `${page.width}/${page.height}` }}
      >
        <canvas ref={canvas} />
        {ready && (
          <div className="pdf-fields">
            {page.fields
              .filter((f) => !f.section || f.section === section)
              .map((f) => {
                const style = {
                  left: `${(f.x / page.width) * 100}%`,
                  top: `${(f.y / page.height) * 100}%`,
                  width: `${(f.width / page.width) * 100}%`,
                  height: `${(f.height / page.height) * 100}%`,
                  fontSize: `${(Math.min(f.fontSize, Math.max(5, f.height - 3)) / page.width) * 100}cqw`,
                };
                const label = `${form.title}: ${f.label}`;
                return f.type === "checkbox" ? (
                  <input
                    key={fieldKey(f)}
                    type="checkbox"
                    style={style}
                    checked={values[fieldKey(f)] === true}
                    aria-label={label}
                    title={f.label}
                    onChange={(e) => onField(f, e.target.checked)}
                  />
                ) : f.multiline ? (
                  <textarea
                    key={fieldKey(f)}
                    style={style}
                    value={String(values[fieldKey(f)] ?? "")}
                    aria-label={label}
                    title={f.label}
                    maxLength={2000}
                    onChange={(e) => onField(f, e.target.value)}
                  />
                ) : (
                  <input
                    key={fieldKey(f)}
                    type="text"
                    style={style}
                    value={String(values[fieldKey(f)] ?? "")}
                    aria-label={label}
                    title={f.label}
                    maxLength={500}
                    onChange={(e) => onField(f, e.target.value)}
                  />
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
export function SoldPack({
  workspace,
  customer,
  opportunity: o,
  mode,
  variant = "without-trade",
  formIds,
  titleCaseId,
  demo,
  busy,
  run,
  onClose,
}: {
  workspace: Workspace;
  customer: Customer;
  opportunity: Opportunity;
  mode: "pack" | "mvr2";
  variant?: SoldPackVariant;
  formIds?: readonly string[];
  titleCaseId?: string;
  demo: boolean;
  busy: boolean;
  run: (c: Command, message?: string) => Promise<{ ok: boolean }>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [index, setIndex] = useState(0),
    [pageIndex, setPageIndex] = useState(0),
    [paperwork, setPaperwork] = useState<Paperwork>(() =>
      structuredClone(o.paperwork ?? {}),
    ),
    [revision, setRevision] = useState(o.paperwork_revision),
    [dirty, setDirty] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [showShared, setShowShared] = useState(false),
    [confirmClose, setConfirmClose] = useState(false),
    [archivePacket, setArchivePacket] = useState(!demo),
    [includeLicenses, setIncludeLicenses] = useState(true),
    [licenses, setLicenses] = useState<
      { name: string; license: SavedLicense }[]
    >([]),
    [licenseError, setLicenseError] = useState(""),
    [licenseLoading, setLicenseLoading] = useState(mode === "pack" && !formIds),
    [licenseRetry, setLicenseRetry] = useState(0);
  const licenseCustomerIds = [customer.id, o.co_buyer_id].filter(
    (id): id is string => !!id,
  );
  const licenseKey = licenseCustomerIds.join(":");
  useEffect(() => {
    if (mode !== "pack" || formIds) return;
    const controller = new AbortController();
    setLicenseLoading(true);
    setLicenseError("");
    void Promise.all(
      licenseKey.split(":").map(async (id) => {
        const license = await customerLicense(id, demo, controller.signal);
        return license
          ? { name: id === customer.id ? customer.name : "Co-buyer", license }
          : null;
      }),
    )
      .then((found) => {
        if (!controller.signal.aborted)
          setLicenses(
            found.filter(
              (entry): entry is { name: string; license: SavedLicense } =>
                entry !== null,
            ),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLicenseError(
            "License files could not be checked. Retry, or uncheck license copies to print without them.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLicenseLoading(false);
      });
    return () => controller.abort();
  }, [
    licenseKey,
    customer.id,
    customer.name,
    demo,
    mode,
    formIds,
    licenseRetry,
  ]);
  const missing = deliveryChecks(workspace, o).filter((c) => !c.ready);
  const context = useMemo(
    () => documentContext(workspace, customer, o),
    [workspace, customer, o],
  );
  const forms = useMemo(() => {
    return mode === "mvr2"
      ? [mvr2Form]
      : formIds?.length
        ? selectedPrintForms(formIds)
        : soldPackForms(variant);
  }, [variant, formIds, mode]);
  const form = mode === "mvr2" ? mvr2Form : forms[index],
    section = Number(paperwork.$mvr2?.section) || 1,
    values = formValues(form, context, paperwork, section);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  function change(group: string, key: string, value: string | boolean) {
    setPaperwork((p) => ({ ...p, [group]: { ...p[group], [key]: value } }));
    setDirty(true);
  }
  function fieldChange(f: FormField, value: string | boolean) {
    setPaperwork((p) => {
      const group = { ...p[form.id], [fieldKey(f)]: value };
      if (value === true && (f.exclusiveGroup || f.radioGroup))
        for (const other of form.pages.flatMap((p) => p.fields)) {
          if (
            fieldKey(other) !== fieldKey(f) &&
            ((f.exclusiveGroup && other.exclusiveGroup === f.exclusiveGroup) ||
              (f.radioGroup && other.radioGroup === f.radioGroup))
          )
            group[fieldKey(other)] = false;
        }
      return { ...p, [form.id]: group };
    });
    setDirty(true);
  }
  async function save() {
    if (!dirty) return true;
    setError("");
    const result = await run(
      { type: "save_paperwork", opportunity_id: o.id, revision, paperwork },
      "Paperwork corrections saved to this opportunity",
    );
    if (result.ok) {
      setRevision((n) => n + 1);
      setDirty(false);
      return true;
    }
    setError(
      "Paperwork could not be saved. If another person edited this packet, close and reopen it before retrying.",
    );
    return false;
  }
  async function output(print: boolean, test = false) {
    const win = print ? window.open("", "_blank") : null;
    if (win) {
      win.document.title = "Preparing paperwork";
      win.document.body.textContent = "Preparing your PDF…";
    }
    setWorking(true);
    setError("");
    try {
      if (!(await save())) {
        win?.close();
        return;
      }
      let bytes =
        mode === "pack"
          ? await buildSoldPack(context, paperwork, template, forms)
          : await buildMvr2(context, paperwork, template, test);
      if (mode === "pack" && !formIds && includeLicenses) {
        if (licenseLoading || licenseError)
          throw Error(
            "Check the saved license files before printing, or uncheck license copies.",
          );
        const copies = await Promise.all(
          licenses.map(async ({ name, license }) => {
            const response = await fetch(licenseImageUrl(license, demo), {
              cache: "no-store",
            });
            if (!response.ok)
              throw Error(
                "A license photo could not be loaded. Retry, or uncheck license copies.",
              );
            return {
              name,
              capturedAt: license.created_at,
              bytes: new Uint8Array(await response.arrayBuffer()),
            };
          }),
        );
        if (copies.length) bytes = await appendLicenseCopies(bytes, copies);
      }
      const blob = new Blob([new Uint8Array(bytes)], {
          type: "application/pdf",
        }),
        url = URL.createObjectURL(blob);
      if (mode === "pack" && archivePacket && !demo) {
        try {
          if (titleCaseId) {
            const file = new File(
              [blob],
              `Drive-Max-DMV-${formIds?.length === 1 ? formIds[0] : "Packet"}-${dayKey()}.pdf`,
              { type: "application/pdf" },
            );
            const saved = await uploadDocument(file, {
              customer_id: customer.id,
              opportunity_id: o.id,
              inventory_id: null,
              kind: "title",
              document_date: dayKey(),
              notes:
                "Generated DMV paperwork; review and obtain required signatures.",
            });
            const linked = await run(
              {
                type: "attach_title_document",
                id: titleCaseId,
                file_id: saved.id,
                purpose: "supporting",
              },
              "DMV copy archived",
            );
            if (!linked.ok)
              throw Error(
                "The PDF is saved in Document Vault. Attach it from the title file’s Documents tab, or uncheck archive to print without another copy.",
              );
          } else {
            await uploadDocument(
              new File(
                [blob],
                `Drive-Max-${formIds ? "DMV" : "Sold-Pack-" + variant}-${new Date().toISOString().slice(0, 10)}.pdf`,
                { type: "application/pdf" },
              ),
              {
                customer_id: customer.id,
                opportunity_id: o.id,
                inventory_id: null,
                kind: "packet",
                document_date: dayKey(),
                notes:
                  "Finalized print packet, including selected license copies.",
              },
            );
          }
        } catch (e) {
          URL.revokeObjectURL(url);
          throw e;
        }
      }
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Drive-Max-${mode === "pack" ? (formIds ? "DMV" : "Sold-Pack-" + variant) : test ? "MVR2-Alignment-Test" : "MVR2-Text-Only"}-${o.id.slice(0, 8)}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch (e) {
      win?.close();
      setError(e instanceof Error ? e.message : "Unable to prepare the PDF.");
    } finally {
      setWorking(false);
    }
  }
  const disabled = busy || working;
  function close() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="paperwork-modal"
      aria-label={
        mode === "pack"
          ? formIds
            ? "DMV document preview"
            : "Sold pack preview"
          : "MVR-2 print preview"
      }
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="paperwork-head">
        <div>
          <span className="eyebrow">
            {mode === "pack"
              ? formIds
                ? "DMV PAPERWORK"
                : `SOLD ${variant === "with-trade" ? "WITH TRADE" : "WITHOUT TRADE"}`
              : "PREPRINTED FORM"}
          </span>
          <h2>
            {mode === "pack" ? "Review, then print." : "MVR-2 text overlay"}
          </h2>
          <p>
            {customer.name} · {o.title} ·{" "}
            {opportunityOpen(o)
              ? "Working opportunity"
              : "Closed deal snapshot"}
          </p>
        </div>
        <button
          className="icon-btn"
          aria-label="Close paperwork preview"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {mode === "pack" && (
        <div className="print-preflight">
          <strong>Delivery review</strong>
          <p>
            {missing.length
              ? `Profile information to review: ${missing.map((c) => c.label).join("; ")}. Packet overrides may already contain your corrections.`
              : "Buyer, vehicle, saved figures, insurance and trade information are present. Review disclosures and signatures before delivery."}
          </p>
          {!demo && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={archivePacket}
                onChange={(e) => setArchivePacket(e.target.checked)}
              />
              Archive this exact PDF in the customer's Delivery → Deal file when
              printed or downloaded
            </label>
          )}
          {!formIds && (
            <div className="license-pack-review">
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={includeLicenses}
                  disabled={working}
                  onChange={(e) => setIncludeLicenses(e.target.checked)}
                />
                Include saved driver license copies with this sold pack
                {licenseLoading
                  ? " · Checking…"
                  : ` · ${licenses.length} available`}
              </label>
              <div className="license-pack-files">
                {licenses.map(({ name, license }) => (
                  <a
                    key={license.id}
                    href={licenseImageUrl(license, demo)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View {name === "Co-buyer" ? "co-buyer" : "buyer"} license ·{" "}
                    {new Date(license.created_at).toLocaleDateString("en-US", {
                      timeZone: "America/New_York",
                    })}
                  </a>
                ))}
              </div>
              {licenseError && (
                <p className="form-error" role="alert">
                  {licenseError}{" "}
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setLicenseRetry((n) => n + 1)}
                  >
                    Retry license check
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="paperwork-toolbar">
        <button
          className="btn small"
          disabled={disabled || !dirty}
          onClick={save}
        >
          <Save size={15} />
          {dirty ? "Save corrections" : "Corrections saved"}
        </button>
        <button
          className="btn small"
          onClick={() => setShowShared(!showShared)}
        >
          Shared print details
        </button>
        <span className="paperwork-spacer" />
        <button
          className="btn small"
          disabled={disabled}
          onClick={() => output(false)}
        >
          <Download size={15} />
          Download PDF
        </button>
        {mode === "mvr2" && (
          <button
            className="btn small"
            disabled={disabled}
            onClick={() => output(true, true)}
          >
            Plain-paper test
          </button>
        )}
        <button
          className="btn primary small"
          disabled={disabled}
          onClick={() => output(true)}
        >
          <Printer size={15} />
          {working
            ? "Preparing…"
            : mode === "pack"
              ? "Open printable PDF"
              : "Print text only"}
        </button>
      </div>
      {error && (
        <p className="form-error paperwork-alert" role="alert">
          {error}
        </p>
      )}
      {confirmClose && (
        <div className="paperwork-unsaved">
          <p>You have unsaved corrections.</p>
          <button className="btn small" onClick={() => setConfirmClose(false)}>
            Keep editing
          </button>
          <button className="btn small" onClick={onClose}>
            Discard changes
          </button>
          <button
            className="btn primary small"
            disabled={disabled}
            onClick={async () => {
              if (await save()) onClose();
            }}
          >
            Save and close
          </button>
        </div>
      )}
      {showShared && (
        <section className="shared-print-details">
          <p>
            These values fill matching fields across the packet. A correction
            made directly on a form takes priority. Saved only with this
            opportunity’s paperwork.
          </p>
          <div className="form-grid">
            {sharedPrintFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={String(paperwork.$common?.[key] ?? context[key] ?? "")}
                  onChange={(e) => change("$common", key, e.target.value)}
                  maxLength={250}
                />
              </label>
            ))}
          </div>
        </section>
      )}
      <div className="paperwork-layout">
        <aside className="paperwork-sidebar">
          {mode === "pack" ? (
            <>
              <span className="eyebrow">
                {forms.length} FORMS · IN PRINT ORDER
              </span>
              <nav aria-label={titleCaseId ? "DMV forms" : "Sold pack forms"}>
                {forms.map((f, i) => (
                  <button
                    key={f.id}
                    className={i === index ? "selected" : ""}
                    onClick={() => {
                      setIndex(i);
                      setPageIndex(0);
                    }}
                    aria-current={i === index ? "page" : undefined}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {f.title}
                  </button>
                ))}
              </nav>
              <p>
                Click the highlighted fields to edit. Signatures and notarial
                sections stay blank for execution.
              </p>
              {forms.some((f) => f.id === "MVR-6TT") && (
                <p>
                  MVR-6TT is Title in Transit and applies when the original
                  title is unavailable. Review certifications and omit any
                  inapplicable pages in the print dialog.
                </p>
              )}
              {form.source?.url && (
                <p>
                  <a href={form.source.url} target="_blank" rel="noreferrer">
                    Official blank PDF
                  </a>
                </p>
              )}
            </>
          ) : (
            <>
              <h3>Printer alignment</h3>
              <label>
                Reassignment section
                <select
                  value={section}
                  onChange={(e) => change("$mvr2", "section", e.target.value)}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      Section {n}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ["x", "Horizontal offset (points)"],
                ["y", "Vertical offset (points)"],
                ["scale", "Scale (%)"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    step={key === "scale" ? "0.1" : "0.5"}
                    min={key === "scale" ? 95 : -36}
                    max={key === "scale" ? 105 : 36}
                    value={String(
                      paperwork.$mvr2?.[key] ?? (key === "scale" ? 100 : 0),
                    )}
                    onChange={(e) => change("$mvr2", key, e.target.value)}
                  />
                </label>
              ))}
              <p>
                Positive offsets move text right/down. 72 points = 1 inch. Print
                at <strong>Actual size / 100%</strong>, without “Fit to page”.
              </p>
              <p>
                The scan is a guide only. Text-only output contains no
                background. Use a plain-paper test to align with your form
                before loading the original.
              </p>
              <p>
                Only the selected reassignment section and vehicle header will
                print. Odometer and damage disclosures require your review.
              </p>
            </>
          )}
          {demo && (
            <p className="fine-print">
              Demo corrections stay in this browser session.
            </p>
          )}
        </aside>
        <main className="paperwork-canvas">
          <div className="paperwork-page-heading">
            <FileText size={17} />
            <strong>{form.title}</strong>
            {mode === "pack" && (
              <span>
                {index + 1} / {forms.length}
              </span>
            )}
          </div>
          {!context["deal.price"] && (
            <p className="paperwork-hint">
              No matching saved Desking proposal. Deal amounts remain blank;
              save a proposal or enter the amounts on the forms.
            </p>
          )}
          {form.id === "trade-MVR-63" && (
            <p className="paperwork-hint">
              MVR-63 cannot be used when a lienholder holds the title. Those
              trades require the secure MVR-63A form. Verify the trade’s legal
              owner and attorney before signing.
            </p>
          )}
          {titleCaseId && (
            <p className="paperwork-hint">
              {titleFormCatalog.find((f) => f.id === form.id)?.help}
            </p>
          )}
          <PdfPage
            key={form.id + ":" + pageIndex}
            form={form}
            values={values}
            onField={fieldChange}
            section={section}
            pageIndex={pageIndex}
          />
          {form.pages.length > 1 && (
            <nav className="paperwork-paging" aria-label="PDF pages">
              <button
                className="btn small"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => p - 1)}
              >
                <ChevronLeft size={14} /> Previous page
              </button>
              <span>
                Page {pageIndex + 1} of {form.pages.length} · All pages print
              </span>
              <button
                className="btn small"
                disabled={pageIndex === form.pages.length - 1}
                onClick={() => setPageIndex((p) => p + 1)}
              >
                Next page <ChevronRight size={14} />
              </button>
            </nav>
          )}
          <p className="paperwork-hint">
            Review every completed field before signing. Preview edits stay with
            this opportunity and do not change the original customer or Desking
            record.
          </p>
          {mode === "pack" && (
            <div className="paperwork-paging">
              <button
                className="btn small"
                disabled={index === 0}
                onClick={() => {
                  setIndex((i) => i - 1);
                  setPageIndex(0);
                }}
              >
                <ChevronLeft size={14} />
                Previous form
              </button>
              <button
                className="btn small"
                disabled={index === forms.length - 1}
                onClick={() => {
                  setIndex((i) => i + 1);
                  setPageIndex(0);
                }}
              >
                Next form
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </main>
      </div>
    </dialog>
  );
}
