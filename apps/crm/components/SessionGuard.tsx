"use client";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, TimerReset } from "lucide-react";
import { monitorIdleSession } from "../lib/idle-client";
import type { IdleClientState } from "../lib/idle-policy";

export default function SessionGuard({
  initial,
  children,
}: {
  initial: IdleClientState;
  children: React.ReactNode;
}) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const monitor = useRef<ReturnType<typeof monitorIdleSession> | null>(null);
  useEffect(() => {
    const current = monitorIdleSession(initial, {
      warning: setSeconds,
      expired: () => setExpired(true),
    });
    monitor.current = current;
    return () => {
      current.dispose();
      monitor.current = null;
    };
  }, [initial.id, initial.expiresAt, initial.serverNow]);
  if (expired)
    return (
      <main className="session-locked">
        <LockKeyhole size={32} />
        <h1>Session ended</h1>
        <p>Sign in again to continue.</p>
        <a className="btn primary" href="/login?reason=inactive">
          Back to sign in
        </a>
      </main>
    );
  return (
    <>
      {children}
      {seconds !== null && (
        <aside className="session-warning" aria-label="Inactivity warning">
          <TimerReset size={24} aria-hidden="true" />
          <div>
            <strong role="status">
              Still there? Your session is about to end.
            </strong>
            <p>
              Signing out in{" "}
              <b>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </b>{" "}
              due to inactivity.
            </p>
          </div>
          <button
            className="btn primary"
            onClick={() => monitor.current?.stay()}
          >
            Stay signed in
          </button>
        </aside>
      )}
    </>
  );
}
