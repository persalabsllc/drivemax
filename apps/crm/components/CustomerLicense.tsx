"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Avatar, Modal } from "./ui";
import { LicensePortrait } from "./LicenseScanner";
import {
  customerLicense,
  licenseImageUrl,
  licenseSavedEvent,
} from "../lib/customer-license-client";
import type { SavedLicense } from "../lib/license-scan";
export function CustomerLicense({
  customerId,
  name,
  demo,
}: {
  customerId: string;
  name: string;
  demo: boolean;
}) {
  const [license, setLicense] = useState<SavedLicense | null>(null),
    [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [printing, setPrinting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLicense(null);
    void customerLicense(customerId, demo, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLicense(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "License unavailable.");
      });
    return () => controller.abort();
  }, [customerId, demo, revision]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail === customerId)
        setRevision((n) => n + 1);
    };
    window.addEventListener(licenseSavedEvent, refresh);
    return () => window.removeEventListener(licenseSavedEvent, refresh);
  }, [customerId]);
  async function print() {
    if (!license) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.title = "Driver license";
      win.document.body.textContent = "Preparing license copy…";
    }
    setPrinting(true);
    setError("");
    try {
      const response = await fetch(licenseImageUrl(license, demo), {
        cache: "no-store",
      });
      if (!response.ok)
        throw Error("The license could not be loaded. Try again.");
      const { appendLicenseCopies } = await import("../lib/license-print");
      const bytes = await appendLicenseCopies(null, [
        {
          bytes: new Uint8Array(await response.arrayBuffer()),
          name,
          capturedAt: license.created_at,
        },
      ]);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      if (win) win.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = "Driver-license.pdf";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch (err) {
      win?.close();
      setError(
        err instanceof Error ? err.message : "License could not be printed.",
      );
    } finally {
      setPrinting(false);
    }
  }
  return (
    <>
      <div className="customer-license-avatar">
        {license ? (
          <button
            className="license-avatar-button"
            type="button"
            aria-label={`View ${name}'s driver license`}
            onClick={() => {
              setOpen(true);
              setError("");
            }}
          >
            <LicensePortrait
              src={licenseImageUrl(license, demo)}
              crop={license.license_portrait}
              alt={`${name}'s profile photo`}
            />
          </button>
        ) : (
          <Avatar name={name} size="large" />
        )}
        {error && !open && (
          <button
            type="button"
            className="text-btn license-retry"
            title={error}
            onClick={() => setRevision((n) => n + 1)}
          >
            Retry license
          </button>
        )}
      </div>
      {open && license && (
        <Modal
          title="Driver license"
          subtitle={`${name} · Saved ${new Date(license.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}`}
          wide
          onClose={() => setOpen(false)}
        >
          <div className="license-viewer">
            <img
              src={licenseImageUrl(license, demo)}
              alt={`Saved driver license for ${name}`}
              onError={() =>
                setError(
                  "The license image could not be loaded. Close and try again.",
                )
              }
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn"
              disabled={printing}
              onClick={print}
            >
              <Printer size={16} />
              {printing ? "Preparing…" : "Print license copy"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
