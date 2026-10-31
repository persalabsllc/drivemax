import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  activityPath,
  activitySource,
  activityRequestSchema,
  privacySignal,
  excludedAgent,
} from "../lib/website-activity";
test("analytics only accepts safe public routes and strips sensitive URL parts", () => {
  assert.equal(
    activityPath("/inventory/2018-nissan-versa-abcd?email=private#section"),
    "/inventory/2018-nissan-versa-abcd",
  );
  for (const path of [
    "/control-room",
    "/control-room/login",
    "/api/chat",
    "/crm/customers/123",
    "//evil.invalid",
    "/apply/secret",
  ])
    assert.equal(activityPath(path), null);
  assert.equal(activityPath("/"), "/");
  assert.equal(activityPath("/about/staff/"), "/about/staff");
});
test("source classification stores a category, never raw referrers or campaigns", () => {
  assert.equal(
    activitySource(
      "https://www.google.com/search?q=private",
      "https://www.drivemaxusedcars.com/inventory",
    ),
    "Google",
  );
  assert.equal(
    activitySource(
      "",
      "https://www.drivemaxusedcars.com/?utm_source=facebook&utm_campaign=private",
    ),
    "Facebook",
  );
  assert.equal(
    activitySource(
      "https://other.example/private?email=private",
      "https://www.drivemaxusedcars.com/",
    ),
    "Referral",
  );
  assert.equal(
    activitySource(
      "https://www.drivemaxusedcars.com/",
      "https://www.drivemaxusedcars.com/inventory",
    ),
    "Direct / unknown",
  );
});
test("public event contract cannot fabricate conversions or submit form contents", () => {
  const event = { id: randomUUID(), kind: "page_view", path: "/inventory" };
  assert(
    activityRequestSchema.safeParse({ action: "events", events: [event] })
      .success,
  );
  for (const change of [
    { kind: "lead_submitted" },
    { customer_id: randomUUID() },
    { text: "private" },
    { path: "/apply?ssn=123" },
    { seconds: 1000 },
  ])
    assert.equal(
      activityRequestSchema.safeParse({
        action: "events",
        events: [{ ...event, ...change }],
      }).success,
      false,
    );
  assert.equal(
    activityRequestSchema.safeParse({
      action: "events",
      events: Array(26).fill(event),
    }).success,
    false,
  );
  assert.equal(
    activityRequestSchema.safeParse({
      action: "choice",
      allow: true,
      visitor_id: randomUUID(),
    }).success,
    false,
  );
});
test("privacy signals and recognizable bots disable collection", () => {
  assert(privacySignal(new Headers({ "sec-gpc": "1" })));
  assert(privacySignal(new Headers({ dnt: "1" })));
  assert(!privacySignal(new Headers()));
  assert(excludedAgent("Googlebot/2.1"));
  assert(excludedAgent("HeadlessChrome/150.0"));
  assert(!excludedAgent("Mozilla/5.0 Chrome/150.0 Safari/537.36"));
});
