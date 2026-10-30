import {
  ACTIVITY_SYNC_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  type IdleClientState,
} from "./idle-policy";

// The server owns the deadline; local activity controls warnings and cross-tab UX.
export function monitorIdleSession(
  initial: IdleClientState,
  callbacks: {
    warning: (seconds: number | null) => void;
    expired: () => void;
  },
) {
  const startedAt = Date.now(),
    startedMono = performance.now();
  let clockAdjustment = 0;
  const now = () =>
    initial.serverNow +
    clockAdjustment +
    Math.max(Date.now() - startedAt, performance.now() - startedMono);
  const key = `dmcrm-activity-v1:${initial.id}`;
  let lastActiveAt = initial.expiresAt - IDLE_TIMEOUT_MS;
  let confirmedUntil = initial.expiresAt;
  let lastSentAt = -Infinity,
    lastPublishedAt = -Infinity;
  let dirty = false,
    stopped = false,
    sending = false,
    checking = false;
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel("dmcrm-session-activity");
  } catch {
    /* Storage still coordinates tabs. */
  }

  const receive = (value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      value.id !== initial.id
    )
      return;
    const record = value as {
      id: string;
      lastActiveAt?: number;
      confirmedUntil?: number;
      loggedOut?: boolean;
    };
    if (record.loggedOut) {
      void expire(false);
      return;
    }
    const time = now();
    if (
      typeof record.lastActiveAt === "number" &&
      Number.isFinite(record.lastActiveAt) &&
      record.lastActiveAt <= time + 5000
    )
      lastActiveAt = Math.max(
        lastActiveAt,
        Math.min(time, record.lastActiveAt),
      );
    if (
      typeof record.confirmedUntil === "number" &&
      Number.isFinite(record.confirmedUntil) &&
      record.confirmedUntil <= time + IDLE_TIMEOUT_MS + 5000
    )
      confirmedUntil = Math.max(confirmedUntil, record.confirmedUntil);
  };
  const readShared = () => {
    try {
      const value = localStorage.getItem(key);
      if (value) receive(JSON.parse(value));
    } catch {
      /* Private browsing can disable storage. */
    }
  };
  const publish = (loggedOut = false) => {
    const record = { id: initial.id, lastActiveAt, confirmedUntil, loggedOut };
    try {
      localStorage.setItem(key, JSON.stringify(record));
    } catch {
      /* In-memory timeout remains active. */
    }
    try {
      channel?.postMessage(record);
    } catch {
      /* Tab may be closing. */
    }
    lastPublishedAt = now();
  };
  async function expire(clearCookies = true, changed = false) {
    if (stopped) return;
    stopped = true;
    callbacks.expired(); // Remove customer data immediately, even when offline.
    if (clearCookies) {
      publish(true);
      try {
        await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logout", id: initial.id }),
          keepalive: true,
          signal: AbortSignal.timeout(4000),
        });
      } catch {
        /* The signed server deadline still blocks expired credentials. */
      }
    }
    window.location.replace(changed ? "/" : "/login?reason=inactive");
  }
  const accept = (data: IdleClientState) => {
    if (data.id !== initial.id) {
      void expire(false, true);
      return;
    }
    if (!Number.isFinite(data.serverNow) || !Number.isFinite(data.expiresAt))
      return;
    clockAdjustment += Math.max(0, data.serverNow - now());
    confirmedUntil = Math.max(confirmedUntil, data.expiresAt);
    lastActiveAt = Math.max(lastActiveAt, data.expiresAt - IDLE_TIMEOUT_MS);
    publish();
  };
  const sync = async (force = false) => {
    if (
      stopped ||
      sending ||
      !dirty ||
      (!force && now() - lastSentAt < ACTIVITY_SYNC_MS)
    )
      return;
    sending = true;
    const reportedActivity = lastActiveAt;
    lastSentAt = now();
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activity",
          id: initial.id,
          idleForMs: Math.max(0, now() - reportedActivity),
        }),
        keepalive: true,
        signal: AbortSignal.timeout(10000),
      });
      if (stopped) return;
      if (response.status === 401 || response.status === 409) {
        void expire(false, response.status === 409);
        return;
      }
      if (response.ok) {
        dirty = lastActiveAt > reportedActivity;
        accept(await response.json());
      }
    } catch {
      /* Retry only unsynced real activity; never renew from polling. */
    } finally {
      sending = false;
    }
  };
  const checkServer = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (stopped) return;
      if (response.status === 401) {
        void expire(false);
        return;
      }
      if (response.ok) accept(await response.json());
    } catch {
      /* Existing deadline still applies while offline. */
    } finally {
      checking = false;
    }
  };
  const tick = () => {
    if (stopped) return;
    readShared();
    if (stopped) return;
    const remaining =
      Math.min(lastActiveAt + IDLE_TIMEOUT_MS, confirmedUntil) - now();
    if (remaining <= 0) {
      void expire();
      return;
    }
    callbacks.warning(
      remaining <= IDLE_WARNING_MS ? Math.ceil(remaining / 1000) : null,
    );
    void sync();
  };
  const activity = (event?: Event) => {
    if (
      stopped ||
      (event && !event.isTrusted) ||
      document.visibilityState !== "visible"
    )
      return;
    if (event && now() - lastActiveAt < 1000) return;
    // Check expiry BEFORE handling the first click after sleep or a long absence.
    tick();
    if (stopped) return;
    lastActiveAt = now();
    dirty = true;
    callbacks.warning(null);
    if (lastActiveAt - lastPublishedAt >= 1000) publish();
    void sync();
  };
  const wake = () => {
    tick();
    if (document.visibilityState === "visible") void checkServer();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key && event.newValue) {
      try {
        receive(JSON.parse(event.newValue));
        tick();
      } catch {
        /* Ignore malformed browser state. */
      }
    }
  };
  if (channel)
    channel.onmessage = (event) => {
      receive(event.data);
      tick();
    };
  const events = [
    "pointerdown",
    "pointermove",
    "keydown",
    "wheel",
    "touchstart",
  ];
  for (const event of events)
    window.addEventListener(event, activity, { passive: true, capture: true });
  window.addEventListener("storage", storage);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", wake);
  const flush = () => {
    if (dirty) {
      publish();
      void sync(true);
    }
  };
  window.addEventListener("pagehide", flush);
  const timer = window.setInterval(tick, 1000);
  const statusTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void checkServer();
  }, 60000);
  tick();
  void checkServer();
  return {
    stay: () => {
      activity();
      void sync(true);
    },
    dispose: () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(statusTimer);
      for (const event of events)
        window.removeEventListener(event, activity, true);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", wake);
      channel?.close();
    },
  };
}
