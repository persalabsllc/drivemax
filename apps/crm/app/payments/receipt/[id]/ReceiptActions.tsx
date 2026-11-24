"use client";

import { useEffect } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import styles from "./receipt.module.css";

export default function ReceiptActions({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    let active = true;
    const logo = document.getElementById("receipt-logo") as HTMLImageElement | null;
    async function printWhenReady() {
      // Wait for the dealership artwork on the first visit to this device.
      if (logo) await logo.decode().catch(() => undefined);
      if (!active) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("print");
      window.history.replaceState(window.history.state, "", url);
      window.print();
    }
    void printWhenReady();
    return () => { active = false; };
  }, [autoPrint]);

  return (
    <div className={styles.controls}>
      <a className="btn" href="/?view=payments"><ArrowLeft size={16} aria-hidden="true" /> Back to payments</a>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        <Printer size={16} aria-hidden="true" /> Print receipt
      </button>
    </div>
  );
}
