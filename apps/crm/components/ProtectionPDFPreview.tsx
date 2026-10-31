"use client";
import { useEffect, useState } from "react";
import type { ProtectionContract } from "../lib/protection";
import { Modal } from "./ui";

export function ProtectionPDFPreview({
  contract,
  contracts,
  demo,
  draft = false,
  cancellation = false,
  onClose,
}: {
  contract?: ProtectionContract;
  contracts?: ProtectionContract[];
  demo: boolean;
  draft?: boolean;
  cancellation?: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      objectUrl = "";
    async function load() {
      const packet = contracts ?? (contract ? [contract] : []);
      if (!packet.length) throw Error("No contracts selected.");
      let blob: Blob;
      if (demo || draft) {
        const [
          { buildProtectionPdf, buildProtectionPacketPdf },
          response,
          regular,
          bold,
        ] = await Promise.all([
          import("../lib/protection-pdf"),
          fetch("/print-materials/drive-max-logo.png"),
          fetch("/pdf-standard-fonts/LiberationSans-Regular.ttf"),
          fetch("/pdf-standard-fonts/LiberationSans-Bold.ttf"),
        ]);
        if (!response.ok || !regular.ok || !bold.ok)
          throw Error(
            "The contract logo could not be loaded. Please try again.",
          );
        const logo = new Uint8Array(await response.arrayBuffer());
        const fonts = {
          regular: new Uint8Array(await regular.arrayBuffer()),
          bold: new Uint8Array(await bold.arrayBuffer()),
        };
        const bytes = cancellation
          ? await buildProtectionPdf(packet[0], logo, draft, true, fonts)
          : await buildProtectionPacketPdf(packet, logo, draft, fonts);
        blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      } else {
        const response = await fetch(
          contracts
            ? "/api/protection/packet"
            : `/api/protection/${contract!.id}/document${cancellation ? "?cancellation=1" : ""}`,
          contracts
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: contracts.map((c) => c.id) }),
                cache: "no-store",
              }
            : { cache: "no-store" },
        );
        if (!response.ok)
          throw Error(
            (await response.json()).error ||
              "The contract could not be loaded.",
          );
        blob = await response.blob();
      }
      if (stopped) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }
    load().catch((e) => {
      if (!stopped)
        setError(e instanceof Error ? e.message : "Could not prepare the PDF.");
    });
    return () => {
      stopped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contract, contracts, demo, draft, cancellation]);
  return (
    <Modal
      wide
      title={
        draft
          ? "Review contract before issuance"
          : cancellation
            ? "Cancellation statement"
            : contracts
              ? `Selected contracts · ${contracts.length}`
              : (contract?.contract_number ?? "Contract PDF")
      }
      subtitle={
        draft
          ? "Draft only. Issue the contract to assign its permanent number."
          : "Open the PDF to print, or download a copy."
      }
      onClose={onClose}
    >
      <div className="protection-pdf">
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : !url ? (
          <p role="status">Preparing PDF…</p>
        ) : (
          <>
            <div className="ops-actions">
              <a
                className="btn primary"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Open / print PDF
              </a>
              <a
                className="btn"
                href={url}
                download={`${draft ? "Drive-Max-Protection-draft" : contracts ? "Drive-Max-Protection-Packet" : (contract?.contract_number ?? "Contract PDF")}${cancellation ? "-cancellation" : ""}.pdf`}
              >
                Download PDF
              </a>
            </div>
            <iframe title="Drive Max Protection contract PDF" src={url} />
          </>
        )}
      </div>
    </Modal>
  );
}
