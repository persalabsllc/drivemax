"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  activityPath,
  activitySource,
  type ActivityKind,
} from "../../lib/website-activity";

type Event = { id: string; kind: ActivityKind; path: string; seconds?: number };
export default function WebsiteActivity() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<"allow" | "deny" | null | undefined>(),
    [open, setOpen] = useState(false),
    [signal, setSignal] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const queue = useRef<Event[]>([]),
    sending = useRef<Promise<void> | null>(null),
    active = useRef(false),
    source = useRef("Direct / unknown");
  const safePath = activityPath(pathname);
  useEffect(() => {
    source.current = activitySource(document.referrer, window.location.href);
    fetch("/api/activity", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setChoice(d.choice);
        setSignal(d.privacy_signal);
      })
      .catch(() => setChoice("deny"));
  }, []);
  async function flush() {
    if (!active.current || !queue.current.length) return;
    if (sending.current) {
      await sending.current;
      if (queue.current.length) await flush();
      return;
    }
    const events = queue.current.splice(0, 25);
    sending.current = fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action: "events",
        source: source.current,
        events,
      }),
    })
      .then(() => {})
      .catch(() => {})
      .finally(() => {
        sending.current = null;
      });
    await sending.current;
  }
  useEffect(() => {
    active.current = choice === "allow" && !!safePath;
    if (!active.current || !safePath) {
      queue.current = [];
      return;
    }
    let seconds = 0,
      last = Date.now(),
      interaction = Date.now(),
      started = false;
    const add = (kind: ActivityKind, time?: number) => {
      queue.current.push({
        id: crypto.randomUUID(),
        kind,
        path: safePath,
        ...(time ? { seconds: time } : {}),
      });
      void flush();
    };
    const heartbeat = () => {
      const now = Date.now();
      if (!document.hidden && now - interaction < 60000)
        seconds += Math.min(5, (now - last) / 1000);
      last = now;
      if (seconds >= 15) {
        add("engagement", Math.min(30, Math.floor(seconds)));
        seconds = 0;
      }
    };
    const touch = () => {
      interaction = Date.now();
    };
    const click = (event: MouseEvent) => {
      touch();
      const el =
        event.target instanceof Element
          ? event.target.closest("a,button")
          : null;
      if (!el) return;
      const href = el.getAttribute("href") || "";
      if (href.startsWith("tel:")) add("call_click");
      else if (href.startsWith("mailto:")) add("email_click");
      else if (el.getAttribute("data-activity") === "photo_view")
        add("photo_view");
      else if (el.getAttribute("aria-label") === "Chat with Drive Max")
        add("chat_open");
    };
    const focus = (event: FocusEvent) => {
      if (
        !started &&
        event.target instanceof Element &&
        event.target.closest("form.lead-form")
      ) {
        started = true;
        add("form_start");
      }
    };
    const leave = () => {
      if (seconds >= 1) {
        add("engagement", Math.min(30, Math.floor(seconds)));
        seconds = 0;
      }
      void flush();
    };
    const visibility = () => {
      if (document.hidden) leave();
      else {
        last = Date.now();
        interaction = last;
      }
    };
    add("page_view");
    const timer = setInterval(heartbeat, 5000);
    document.addEventListener("click", click);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", touch);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("scroll", touch, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      leave();
      clearInterval(timer);
      document.removeEventListener("click", click);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", touch);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("scroll", touch);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
    // Each route gets one view and its own engagement timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, safePath]);
  async function choose(allow: boolean) {
    setBusy(true);
    setError("");
    if (!allow) {
      active.current = false;
      queue.current = [];
    }
    try {
      if (sending.current) await sending.current;
      const r = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "choice", allow }),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      setChoice(d.choice);
      setOpen(false);
    } catch {
      setError("Your choice could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!safePath) return null;
  return (
    <>
      <button className="activity-privacy-button" onClick={() => setOpen(true)}>
        Privacy choices
      </button>
      {(choice === null || open) && (
        <section
          className="activity-consent"
          aria-label="Website analytics choice"
        >
          <div>
            <strong>A little insight. A better experience.</strong>
            <p>
              May we use analytics cookies to understand which vehicles and
              pages interest you? If you send an inquiry, we can connect this
              visit to it. We don’t record what you type into forms.{" "}
              <Link href="/privacy-policy#website-analytics">Learn more</Link>
            </p>
          </div>
          {signal && (
            <p>Your browser’s privacy signal has turned analytics off.</p>
          )}
          <div className="activity-consent-actions">
            <button
              disabled={busy}
              className="button button-outline button-small"
              onClick={() => choose(false)}
            >
              No thanks
            </button>
            <button
              disabled={busy || signal}
              className="button button-primary button-small"
              onClick={() => choose(true)}
            >
              Allow analytics
            </button>
            {choice !== null && (
              <button
                className="button button-outline button-small"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </>
  );
}
