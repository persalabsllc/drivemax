"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Bell, CheckCircle2, RefreshCw, X } from "lucide-react";
import { attentionLabel, type AttentionFeed, type AttentionItem } from "../lib/attention";

export function AttentionBell({ feed, error, busy, onOpen, onRefresh }: {
  feed: AttentionFeed;
  error: string;
  busy: boolean;
  onOpen: (item: AttentionItem) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="attention-notifications" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`attention-bell ${feed.total ? "has-alerts" : ""}`}
        aria-label={`${feed.total} items need attention${error ? ". Alerts could not refresh" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open && !busy) onRefresh();
          setOpen(!open);
        }}
      >
        <Bell size={18} aria-hidden="true" />
        <span aria-live="polite">{error ? "!" : feed.total}</span>
      </button>
      {open && (
        <section
          ref={panel}
          id={id}
          role="dialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          tabIndex={-1}
          className="attention-popover"
        >
          <header className="attention-popover-head">
            <div>
              <h2 id={`${id}-title`}>Needs attention <span className="attention-count">{feed.total}</span></h2>
              <p id={`${id}-description`}>Select an alert to open its details.</p>
            </div>
            <div className="attention-popover-controls">
              <button type="button" className="icon-btn" aria-label="Refresh alerts" onClick={onRefresh} disabled={busy}>
                <RefreshCw size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label="Close alerts" onClick={close}>
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="attention-popover-body">
            {error && <p className="attention-popover-error" role="alert">{error} Displayed alerts may be out of date.</p>}
            {feed.items.length > 0 ? (
              <ul className="attention-popover-list">
                {feed.items.map(item => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="attention-popover-item"
                      data-kind={item.kind}
                      disabled={busy}
                      onClick={() => { close(); onOpen(item); }}
                    >
                      <span className="attention-popover-kind">{attentionLabel[item.kind]}</span>
                      <strong>{item.customer_name}</strong>
                      <span className="attention-popover-title">{item.title}</span>
                      {item.detail && <span className="attention-popover-detail">{item.detail}</span>}
                      <ArrowUpRight className="attention-popover-arrow" size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="attention-popover-empty">
                <CheckCircle2 size={25} aria-hidden="true" />
                <strong>{error || feed.total ? "Check your alerts" : "You’re all caught up"}</strong>
                <p>{error || feed.total ? "Refresh to check your latest alerts." : "New replies, leads and due tasks will appear here."}</p>
              </div>
            )}
          </div>
          <footer className="attention-popover-footer">
            {feed.total > feed.items.length
              ? `Showing ${feed.items.length} of ${feed.total}. Review alerts in Overview to see the next ones.`
              : "Alerts update automatically. Opening this box won’t mark them reviewed."}
          </footer>
        </section>
      )}
    </div>
  );
}
