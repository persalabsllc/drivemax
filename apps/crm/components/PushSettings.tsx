"use client";
import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { SectionTitle } from "./ui";
export function PushSettings({ demo }: { demo: boolean }) {
  const [supported, setSupported] = useState(false),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    setSupported(
      "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .getRegistration("/")
        .then((r) => r?.pushManager.getSubscription())
        .then(async (s) => {
          if (!s || demo) return;
          const r = await fetch("/api/notifications", { cache: "no-store" });
          if (r.ok) {
            const data = await r.json();
            setActive(data.endpoints?.includes(s.endpoint) ?? false);
          }
        })
        .catch(() => {});
  }, [demo]);
  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      if (demo) throw Error("Enable notifications from the live CRM.");
      if (!active && Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw Error(
            "Allow notifications in your browser settings to enable alerts.",
          );
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current && active) {
        const r = await fetch("/api/notifications", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        if (!r.ok) throw Error("Could not disable notifications.");
        await current.unsubscribe();
        setActive(false);
        return;
      }
      const r = await fetch("/api/notifications", { cache: "no-store" });
      const { publicKey } = await r.json();
      if (!publicKey) throw Error("Notification service is not ready yet.");
      const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const sub =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      const saved = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const result = await saved.json();
      if (!saved.ok) {
        if (!current) await sub.unsubscribe();
        throw Error(result.error);
      }
      setActive(true);
      setMessage("Notifications enabled on this device.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel push-settings">
      <SectionTitle
        title="Device notifications"
        subtitle="Alerts for new leads, customer replies and daily follow-up, including when the CRM is closed."
      />
      <p className="work-note">
        On iPhone, open the CRM in Safari, choose Share → Add to Home Screen,
        then open that icon and enable notifications here. This uses browser
        notifications, not paid text messages.
      </p>
      <button className="btn" disabled={busy || !supported} onClick={toggle}>
        <Bell size={15} />
        {active ? "Disable on this device" : "Enable on this device"}
      </button>
      {!supported && (
        <p className="subtext">
          Use a supported browser or the installed home-screen app.
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
