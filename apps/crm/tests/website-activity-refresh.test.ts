import test from "node:test";
import assert from "node:assert/strict";
import { activityRange } from "../lib/website-activity";
import { observeActivityRefresh } from "../lib/website-activity-refresh";

test("rolling reports include the new Eastern day across midnight and DST", () => {
  assert.deepEqual(activityRange(30, new Date("2026-11-01T03:59:59Z")), {
    from: "2026-10-02",
    to: "2026-10-31",
  });
  for (const time of [
    "2026-11-01T04:00:00Z",
    "2026-11-01T06:30:00Z",
    "2026-11-02T04:59:59Z",
  ])
    assert.deepEqual(activityRange(30, new Date(time)), {
      from: "2026-10-03",
      to: "2026-11-01",
    });
  assert.deepEqual(activityRange(7, new Date("2026-11-02T05:00:00Z")), {
    from: "2026-10-27",
    to: "2026-11-02",
  });
});

test("reports refresh on the timer and on return, pause while hidden, and clean up", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const page = Object.assign(new EventTarget(), { hidden: false });
  const browser = new EventTarget();
  let updates = 0;
  const stop = observeActivityRefresh(() => updates++, page, browser);
  t.mock.timers.tick(14_999);
  assert.equal(updates, 0);
  t.mock.timers.tick(1);
  assert.equal(updates, 1);
  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(30_000);
  browser.dispatchEvent(new Event("focus"));
  assert.equal(updates, 1);
  page.hidden = false;
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(updates, 2);
  browser.dispatchEvent(new Event("focus"));
  browser.dispatchEvent(new Event("online"));
  assert.equal(updates, 4);
  stop();
  t.mock.timers.tick(30_000);
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("focus"));
  assert.equal(updates, 4);
});
