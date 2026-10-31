"use client";
import { useEffect, useState } from "react";
import { Bell, ArrowUpRight, Check, RefreshCw } from "lucide-react";
import {
  attentionLabel,
  demoAttention,
  type AttentionFeed,
  type AttentionItem,
} from "../lib/attention";
import type { Workspace } from "../lib/model";

/** Poll only alerts: a background refresh must never replace an open deal draft. */
export function useAttention(ws: Workspace, demo: boolean, busy: boolean) {
  const [feed, setFeed] = useState<AttentionFeed>(() =>
    demo ? demoAttention(ws) : (ws.attention ?? { items: [], total: 0 }),
  );
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (demo) {
      setFeed(demoAttention(ws));
      return;
    }
    if (ws.attention) setFeed(ws.attention);
    if (busy) return;
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    const poll = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        const r = await fetch("/api/attention", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "Sign in again to refresh alerts."
              : "Alerts could not refresh. Try again.",
          );
        const next = await r.json();
        if (active) {
          setFeed(next);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 30000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [ws, demo, busy, version]);
  return { feed, error, reload: () => setVersion((v) => v + 1) };
}

export function AttentionCenter({
  feed,
  error,
  busy,
  onOpen,
  onReview,
  onRefresh,
}: {
  feed: AttentionFeed;
  error: string;
  busy: boolean;
  onOpen: (item: AttentionItem) => void;
  onReview: (item: AttentionItem) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className="panel attention-center"
      aria-label="Needs attention"
      id="needs-attention"
    >
      <div className="section-heading">
        <div>
          <h2>
            <Bell size={19} /> Needs attention{" "}
            <span className="attention-count">{feed.total}</span>
          </h2>
          <p>Replies, new leads, failed messages and due tasks.</p>
        </div>
        <button className="btn small" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={14} /> Refresh alerts
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error} The displayed alerts may be out of date.
        </p>
      )}
      {feed.websiteIntake?.connected && (
        <p
          className={
            feed.websiteIntake.pending
              ? "website-intake-status intake-pending"
              : "website-intake-status"
          }
          role={feed.websiteIntake.pending ? "status" : undefined}
        >
          {feed.websiteIntake.pending
            ? `${feed.websiteIntake.pending} website ${feed.websiteIntake.pending === 1 ? "inquiry is" : "inquiries are"} waiting to import. Requests are saved on the website; automatic retries are running. If this persists, check the website’s lead inbox.`
            : "Website connected · New inquiries appear here automatically."}
        </p>
      )}
      {!!feed.websiteInventory?.pending && (
        <p className="website-intake-status intake-pending" role="status">
          {feed.websiteInventory.pending} inventory{" "}
          {feed.websiteInventory.pending === 1
            ? "vehicle needs"
            : "vehicles need"}{" "}
          website sync. Open Inventory to review the listing status and any
          details that need correcting.
        </p>
      )}
      {!!feed.emailQueue?.pending && (
        <p className="website-intake-status intake-pending" role="status">
          {feed.emailQueue.pending} email
          {feed.emailQueue.pending === 1 ? " is" : "s are"} queued for delivery.
          Delivery failures appear here when they need attention.
        </p>
      )}
      <div className="attention-list">
        {feed.items.slice(0, expanded ? 100 : 6).map((item) => (
          <article
            className={`attention-item attention-${item.kind}`}
            key={item.key}
          >
            <span className="attention-kind">{attentionLabel[item.kind]}</span>
            <button
              className="attention-open"
              onClick={() => onOpen(item)}
              disabled={busy}
            >
              <strong>{item.customer_name}</strong>
              <span>{item.title}</span>
              <small>{item.detail}</small>
            </button>
            <div className="attention-actions">
              <button
                className="icon-btn"
                aria-label={`Open ${item.customer_name}: ${item.title}`}
                onClick={() => onOpen(item)}
                disabled={busy}
              >
                <ArrowUpRight size={17} />
              </button>
              {item.kind !== "task" && item.kind !== "chat" && (
                <button
                  className="btn small"
                  aria-label={`Mark reviewed: ${item.customer_name} ${item.title}`}
                  onClick={() => onReview(item)}
                  disabled={busy}
                >
                  <Check size={14} /> Reviewed
                </button>
              )}
            </div>
          </article>
        ))}
        {!feed.items.length && (
          <p className="attention-empty">
            {feed.websiteIntake?.pending ||
            feed.websiteInventory?.pending ||
            feed.emailQueue?.pending
              ? "Website updates are still being processed. Review any notices above."
              : "You’re caught up. New replies and leads will appear here."}
          </p>
        )}
      </div>
      <div className="attention-footer">
        <span>New replies and leads refresh automatically.</span>
        {feed.items.length > 6 && (
          <button className="text-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : `Show all ${feed.items.length}`}
          </button>
        )}
        {feed.total > feed.items.length && (
          <span>
            Showing {feed.items.length} of {feed.total}. Review alerts to see
            the next ones.
          </span>
        )}
      </div>
    </section>
  );
}
