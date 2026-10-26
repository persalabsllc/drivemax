"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function PrintDocument({
  children,
  onClose,
  landscape = false,
}: {
  children: ReactNode;
  onClose: () => void;
  landscape?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
      document.body.classList.remove("ops-printing");
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="ops-print-root"
      aria-label="Print preview"
      onCancel={onClose}
    >
      <div className="ops-print-toolbar">
        <strong>Print preview</strong>
        <button
          className="btn primary"
          onClick={() => {
            document.body.classList.add("ops-printing");
            const done = () => {
              document.body.classList.remove("ops-printing");
              window.removeEventListener("afterprint", done);
            };
            window.addEventListener("afterprint", done);
            window.print();
          }}
        >
          Print / Save PDF
        </button>
        <button className="btn" onClick={onClose}>
          Close preview
        </button>
      </div>
      <style>{`@media print { @page { size: letter ${landscape ? "landscape" : "portrait"}; margin: 0.35in; } }`}</style>
      <article className={`ops-print-document ${landscape ? "landscape" : ""}`}>
        {children}
      </article>
    </dialog>,
    document.body,
  );
}
