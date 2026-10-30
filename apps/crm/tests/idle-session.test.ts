import { test } from "node:test";
import assert from "node:assert/strict";
import { signIdleState, verifyIdleState } from "../lib/idle-token";
import {
  activityTime,
  IDLE_TIMEOUT_MS,
  idleRemaining,
} from "../lib/idle-policy";
import { monitorIdleSession } from "../lib/idle-client";

const id = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const now = 1793448000000;
const secret = "isolated-test-only-signing-key";
const state = { id, userId, lastActiveAt: now };

test("server inactivity token expires at exactly 30 minutes and cannot be forged", () => {
  const token = signIdleState(state, secret);
  assert.deepEqual(verifyIdleState(token, secret, now), state);
  assert.ok(verifyIdleState(token, secret, now + IDLE_TIMEOUT_MS - 1));
  assert.equal(verifyIdleState(token, secret, now + IDLE_TIMEOUT_MS), null);
  assert.equal(verifyIdleState(token, secret, now - 1), null);
  assert.equal(verifyIdleState(token, "another-key", now), null);
  assert.equal(verifyIdleState(token.replace(/.$/, "!"), secret, now), null);
  const forged = Buffer.from(
    JSON.stringify({ ...state, lastActiveAt: now + 60000 }),
  ).toString("base64url");
  assert.equal(
    verifyIdleState(`${forged}.${token.split(".")[1]}`, secret, now),
    null,
  );
  for (const input of [
    undefined,
    "",
    "bad",
    `${token}.extra`,
    "x".repeat(2000),
  ])
    assert.equal(verifyIdleState(input, secret, now), null);
});

test("batched activity preserves its event time and cannot revive an expired interval", () => {
  assert.equal(activityTime(now, 5000, now + 15000), now + 10000);
  assert.equal(activityTime(now, 5000, now + 2000), now);
  for (const invalid of [-1, NaN, Infinity, IDLE_TIMEOUT_MS])
    assert.equal(activityTime(now, invalid, now + 100), null);
  assert.equal(idleRemaining(now, now + IDLE_TIMEOUT_MS), 0);
});

// Deterministic browser clock: exercises the actual monitor without a 30-minute wait.
function browser(
  t: import("node:test").TestContext,
  options: {
    storageFails?: boolean;
    offline?: boolean;
    initialAgeMs?: number;
  } = {},
) {
  let elapsed = 0,
    serverLastActivity = now - (options.initialAgeMs ?? 0),
    activeId = id;
  let expired = 0,
    warning: number | null = null;
  const requests: { action: string; idleForMs?: number }[] = [];
  const redirects: string[] = [];
  const intervals = new Map<number, () => void>();
  const values = new Map<string, string>();
  const win = new EventTarget() as EventTarget & {
    setInterval: typeof setInterval;
    location: { replace: (url: string) => void };
  };
  win.setInterval = ((fn: () => void) => {
    const timer = intervals.size + 1;
    intervals.set(timer, fn);
    return timer;
  }) as unknown as typeof setInterval;
  win.location = {
    replace: (url) => {
      redirects.push(url);
    },
  };
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const globals = {
    window: win,
    document: doc,
    localStorage: {
      getItem(key: string) {
        if (options.storageFails) throw Error("Storage disabled");
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (options.storageFails) throw Error("Storage disabled");
        values.set(key, value);
      },
    },
    BroadcastChannel: class {
      onmessage: unknown;
      postMessage() {}
      close() {}
    },
    clearInterval: (timer: number) => {
      intervals.delete(timer);
    },
    fetch: async (_url: unknown, init?: RequestInit) => {
      const body = init?.body
        ? JSON.parse(String(init.body))
        : { action: "status" };
      requests.push(body);
      if (options.offline) throw Error("Offline");
      if (body.action === "logout") return new Response("{}");
      if (now + elapsed - serverLastActivity >= IDLE_TIMEOUT_MS)
        return new Response("{}", { status: 401 });
      if (body.action === "activity")
        serverLastActivity = Math.max(
          serverLastActivity,
          now + elapsed - body.idleForMs,
        );
      return Response.json({
        id: activeId,
        expiresAt: serverLastActivity + IDLE_TIMEOUT_MS,
        serverNow: now + elapsed,
      });
    },
  };
  const restore: (() => void)[] = [];
  for (const [key, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    restore.push(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(Date, "now", () => now + elapsed);
  t.mock.method(performance, "now", () => elapsed);
  const monitor = monitorIdleSession(
    { id, expiresAt: serverLastActivity + IDLE_TIMEOUT_MS, serverNow: now },
    {
      warning: (value) => {
        warning = value;
      },
      expired: () => {
        expired++;
      },
    },
  );
  t.after(() => {
    monitor.dispose();
    for (const undo of restore) undo();
  });
  const settle = async () => {
    for (let n = 0; n < 15; n++) await Promise.resolve();
  };
  return {
    requests,
    redirects,
    monitor,
    win,
    doc,
    values,
    get expired() {
      return expired;
    },
    get warning() {
      return warning;
    },
    async advance(ms: number) {
      elapsed += ms;
      for (const fn of [...intervals.values()]) fn();
      await settle();
    },
    async sleep(ms: number) {
      elapsed += ms;
      win.dispatchEvent(new Event("focus"));
      await settle();
    },
    async activity() {
      monitor.stay();
      await settle();
    },
    async changeLogin() {
      activeId = userId;
      win.dispatchEvent(new Event("focus"));
      await settle();
    },
    sharedActivity() {
      serverLastActivity = now + elapsed;
      values.set(
        `dmcrm-activity-v1:${id}`,
        JSON.stringify({
          id,
          lastActiveAt: serverLastActivity,
          confirmedUntil: serverLastActivity + IDLE_TIMEOUT_MS,
        }),
      );
    },
    settle,
  };
}

test("background refreshes do not renew inactivity; warns at 28 minutes and signs out at 30", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.advance(28 * 60000);
  assert.equal(b.warning, 120);
  assert.equal(b.expired, 0);
  await b.advance(2 * 60000);
  assert.equal(b.expired, 1);
  assert.equal(b.requests.filter((r) => r.action === "activity").length, 0);
  assert.equal(b.requests.filter((r) => r.action === "logout").length, 1);
  assert.deepEqual(b.redirects, ["/login?reason=inactive"]);
});

test("real activity resets the deadline", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.advance(29 * 60000);
  await b.activity();
  assert.equal(b.warning, null);
  await b.advance(29 * 60000);
  assert.equal(b.expired, 0);
  await b.advance(60000);
  assert.equal(b.expired, 1);
});

test("waking a sleeping device past 30 minutes signs out before a new click can renew", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.sleep(31 * 60000);
  await b.activity();
  assert.equal(b.expired, 1);
  assert.equal(b.requests.filter((r) => r.action === "activity").length, 0);
});

test("another tab's activity extends the shared session without duplicate heartbeats", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.advance(20 * 60000);
  b.sharedActivity();
  await b.advance(20 * 60000);
  assert.equal(b.expired, 0);
  assert.equal(b.requests.filter((r) => r.action === "activity").length, 0);
});

test("reloading with one minute remaining does not restart the 30-minute timer", async (t) => {
  const b = browser(t, { initialAgeMs: 29 * 60000 });
  await b.settle();
  assert.equal(b.warning, 60);
  await b.advance(60000);
  assert.equal(b.expired, 1);
});

test("focus and synthetic input are not user activity", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.advance(20 * 60000);
  b.win.dispatchEvent(new Event("pointermove"));
  await b.sleep(10 * 60000);
  assert.equal(b.expired, 1);
  assert.equal(b.requests.filter((r) => r.action === "activity").length, 0);
});

test("offline browsers with blocked storage still hide data and end the session", async (t) => {
  const b = browser(t, { storageFails: true, offline: true });
  await b.settle();
  await b.advance(30 * 60000);
  assert.equal(b.expired, 1);
  assert.deepEqual(b.redirects, ["/login?reason=inactive"]);
});

test("a stale tab detects a newer login without signing out the new user", async (t) => {
  const b = browser(t);
  await b.settle();
  await b.changeLogin();
  assert.equal(b.expired, 1);
  assert.deepEqual(b.redirects, ["/"]);
  assert.equal(b.requests.filter((r) => r.action === "logout").length, 0);
});
