"use client";

import { useRef, useState } from "react";
import { Download, FileText, Printer, ShieldCheck } from "lucide-react";
import { Modal } from "./ui";
import { vehicleName, type InventoryVehicle } from "../lib/vehicles";
import {
  defaultPrintMaterials,
  printMaterialsFilename,
  printMaterialsSchema,
  printVehicleSchema,
  stickerTotal,
  type PrintMaterialsDraft,
} from "../lib/inventory-print";
import { money } from "../lib/model";

export default function InventoryPrintMaterials({
  vehicle,
  onClose,
}: {
  vehicle: InventoryVehicle;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => defaultPrintMaterials(vehicle));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generating = useRef(false);
  const change = <K extends keyof PrintMaterialsDraft>(
    key: K,
    value: PrintMaterialsDraft[K],
  ) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError("");
    setNotice("");
  };
  const both = draft.sticker && draft.buyersGuide;
  const total = stickerTotal(
    Number(draft.price),
    Number(draft.administrationFee),
  );

  async function output(print: boolean) {
    if (generating.current) return;
    setError("");
    setNotice("");
    const parsed = printMaterialsSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const publicVehicle = printVehicleSchema.safeParse(vehicle);
    if (!publicVehicle.success) {
      setError("Save valid vehicle details in inventory before printing.");
      return;
    }
    // Open in the click event, before async work, so popup blockers don't
    // prevent normal printing. Download remains available as a fallback.
    const preview = print ? window.open("", "_blank") : null;
    if (preview) {
      preview.opener = null;
      preview.document.title = "Preparing Drive Max print materials";
      preview.document.body.textContent = "Preparing your PDF…";
    }
    generating.current = true;
    setWorking(true);
    try {
      const { buildInventoryPrintPdf } =
        await import("../lib/inventory-print-pdf");
      const bytes = await buildInventoryPrintPdf(publicVehicle.data, draft);
      const blob = new Blob([Uint8Array.from(bytes)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      if (preview && !preview.closed) {
        preview.location.href = url;
        setNotice(
          "Your PDF is open in a new tab. Use the PDF viewer’s Print button.",
        );
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = printMaterialsFilename(publicVehicle.data, parsed.data);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setNotice(
          print
            ? "The PDF was downloaded. Open it to print, or allow popups and try again."
            : "Your PDF has been downloaded.",
        );
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch (cause) {
      preview?.close();
      setError(
        cause instanceof Error
          ? cause.message
          : "The PDF could not be prepared. Please try again.",
      );
    } finally {
      generating.current = false;
      setWorking(false);
    }
  }

  return (
    <Modal
      title="Print materials"
      subtitle={`${vehicleName(vehicle)} · Stock ${vehicle.stock_number}`}
      onClose={() => {
        if (!generating.current) onClose();
      }}
      wide
    >
      <div className="inventory-print">
        <p className="inventory-print-intro">
          Choose your documents and review the details before printing. Vehicle
          information comes from saved inventory. Changes here apply to this
          printout only.
        </p>
        <fieldset disabled={working} className="inventory-print-fields">
          <legend className="sr-only">Print material options</legend>
          <div className="inventory-print-choices">
            <label className={draft.sticker ? "selected" : ""}>
              <input
                type="checkbox"
                checked={draft.sticker}
                onChange={(e) => change("sticker", e.target.checked)}
                aria-label="Window sticker"
              />
              <FileText size={23} />
              <span>
                <strong>Window sticker</strong>
                <small>
                  Dealer branding, vehicle details and asking price. One
                  portrait page.
                </small>
              </span>
            </label>
            <label className={draft.buyersGuide ? "selected" : ""}>
              <input
                type="checkbox"
                checked={draft.buyersGuide}
                onChange={(e) => change("buyersGuide", e.target.checked)}
                aria-label="Buyers Guide"
              />
              <ShieldCheck size={23} />
              <span>
                <strong>Buyers Guide</strong>
                <small>
                  Editable warranty terms on the official FTC form. Front and
                  back.
                </small>
              </span>
            </label>
          </div>

          {draft.sticker && (
            <section
              className="inventory-print-section"
              aria-labelledby="sticker-settings-title"
            >
              <div className="inventory-print-section-head">
                <h3 id="sticker-settings-title">Window sticker</h3>
                <span>
                  {Number.isFinite(total) ? money(total) : "—"} total asking
                  price
                </span>
              </div>
              <div className="inventory-print-grid">
                <label>
                  Vehicle price
                  <input
                    aria-label="Window sticker vehicle price"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={draft.price}
                    onChange={(e) => change("price", e.target.value)}
                  />
                </label>
                <label>
                  Dealer administration fee
                  <input
                    aria-label="Window sticker administration fee"
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    value={draft.administrationFee}
                    onChange={(e) =>
                      change("administrationFee", e.target.value)
                    }
                  />
                </label>
              </div>
              <p className="inventory-print-help">
                The printed total includes the administration fee. Tax, title,
                registration and optional products are excluded.
              </p>
              <label>
                Vehicle highlights{" "}
                <small>
                  Optional — include only features you have confirmed.
                </small>
                <textarea
                  aria-label="Vehicle highlights"
                  rows={3}
                  maxLength={500}
                  value={draft.highlights}
                  onChange={(e) => change("highlights", e.target.value)}
                  placeholder="Example: Leather seating, heated front seats, backup camera"
                />
              </label>
            </section>
          )}

          {draft.buyersGuide && (
            <section
              className="inventory-print-section"
              aria-labelledby="guide-settings-title"
            >
              <div className="inventory-print-section-head">
                <h3 id="guide-settings-title">Buyers Guide</h3>
                <span>Review before each sale</span>
              </div>
              <div className="inventory-print-grid">
                <label>
                  Warranty coverage
                  <select
                    aria-label="Warranty coverage"
                    value={draft.warranty}
                    onChange={(e) =>
                      change(
                        "warranty",
                        e.target.value as PrintMaterialsDraft["warranty"],
                      )
                    }
                  >
                    <option value="dealer">Dealer warranty</option>
                    <option value="as_is">As is — no dealer warranty</option>
                    <option value="implied">Implied warranties only</option>
                  </select>
                </label>
                {draft.warranty === "dealer" && (
                  <label>
                    Dealer warranty type
                    <select
                      aria-label="Dealer warranty type"
                      value={draft.warrantyType}
                      onChange={(e) =>
                        change(
                          "warrantyType",
                          e.target.value as PrintMaterialsDraft["warrantyType"],
                        )
                      }
                    >
                      <option value="limited">Limited warranty</option>
                      <option value="full">Full warranty</option>
                    </select>
                  </label>
                )}
              </div>
              {draft.warranty === "dealer" && (
                <>
                  {draft.warrantyType === "limited" && (
                    <div className="inventory-print-grid">
                      <label>
                        Dealer pays labor (%)
                        <input
                          aria-label="Dealer pays labor (%)"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={draft.labor}
                          onChange={(e) => change("labor", e.target.value)}
                        />
                      </label>
                      <label>
                        Dealer pays parts (%)
                        <input
                          aria-label="Dealer pays parts (%)"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={draft.parts}
                          onChange={(e) => change("parts", e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <div className="inventory-print-grid warranty-terms">
                    <label>
                      Systems covered
                      <textarea
                        aria-label="Systems covered"
                        rows={6}
                        maxLength={600}
                        value={draft.systems}
                        onChange={(e) => change("systems", e.target.value)}
                      />
                    </label>
                    <label>
                      Warranty duration
                      <textarea
                        aria-label="Warranty duration"
                        rows={6}
                        maxLength={200}
                        value={draft.duration}
                        onChange={(e) => change("duration", e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="inventory-print-help">
                    Defaults match Drive Max’s written limited warranty: 14 days
                    or 500 miles, whichever occurs first; 100% of covered parts
                    and labor; no deductible. Keep any changes consistent with
                    the separate written warranty.
                  </p>
                </>
              )}
              <label className="inventory-print-check service-contract">
                <input
                  type="checkbox"
                  checked={draft.serviceContract}
                  onChange={(e) => change("serviceContract", e.target.checked)}
                  aria-label="Service contract available"
                />
                <span>
                  <strong>Service contract available</strong>
                  <small>Available for an extra charge.</small>
                </span>
              </label>
              <details className="inventory-print-details">
                <summary>Other warranty coverage</summary>
                {(
                  [
                    [
                      "manufacturerWarranty",
                      "Manufacturer’s warranty still applies",
                    ],
                    [
                      "manufacturerUsedWarranty",
                      "Manufacturer’s used vehicle warranty applies",
                    ],
                    [
                      "otherUsedWarranty",
                      "Other used vehicle warranty applies",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label className="inventory-print-check" key={key}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(e) => change(key, e.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </details>
            </section>
          )}

          <details className="inventory-print-details dealer-details">
            <summary>Dealer information & complaints contact</summary>
            <div className="inventory-print-grid">
              {(
                [
                  ["dealerName", "Dealer name", 100],
                  ["address", "Dealer address", 150],
                  ["phone", "Dealer phone", 40],
                  ["email", "Dealer email", 100],
                  ["website", "Dealer website", 100],
                  [
                    "complaintsContact",
                    "Complaints contact name or position",
                    120,
                  ],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={label}
                    value={draft[key]}
                    maxLength={max}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>
        </fieldset>
        <div className="inventory-print-instructions">
          <Printer size={19} />
          <p>
            {both
              ? "4-page packet: window sticker, blank sticker back, Buyers Guide front and back. Print two-sided and flip on the long edge."
              : draft.buyersGuide
                ? "2-page Buyers Guide. Print both sides of one sheet, flipping on the long edge."
                : "1-page portrait window sticker."}{" "}
            Use US Letter paper at actual size (100%).
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="inventory-print-notice" role="status">
            {notice}
          </p>
        )}
        <div className="inventory-print-footer">
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={working || (!draft.sticker && !draft.buyersGuide)}
            onClick={() => void output(false)}
          >
            <Download size={16} /> Download PDF
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={working || (!draft.sticker && !draft.buyersGuide)}
            onClick={() => void output(true)}
          >
            <Printer size={16} />
            {working ? "Preparing…" : "Preview / print"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
