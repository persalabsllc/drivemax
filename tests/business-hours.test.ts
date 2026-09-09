import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUSINESS_HOURS,
  businessHoursLabel,
  formatBusinessTime,
  REGULAR_OPENING_HOURS,
  APPOINTMENT_NOTE,
} from "../lib/business-hours";
import { dealershipSchema } from "../lib/seo";

test("the complete weekly schedule matches the dealership's supplied hours", () => {
  assert.deepEqual(
    BUSINESS_HOURS.map((hours) => [hours.day, businessHoursLabel(hours)]),
    [
      ["Monday", "By appointment"],
      ["Tuesday", "9 AM – 5 PM"],
      ["Wednesday", "9 AM – 5 PM"],
      ["Thursday", "9 AM – 5 PM"],
      ["Friday", "9 AM – 5 PM"],
      ["Saturday", "12 PM – 4 PM"],
      ["Sunday", "By appointment"],
    ],
  );
});

test("time formatting distinguishes noon from midnight and preserves minutes", () => {
  assert.equal(formatBusinessTime("12:00"), "12 PM");
  assert.equal(formatBusinessTime("00:00"), "12 AM");
  assert.equal(formatBusinessTime("09:30"), "9:30 AM");
  assert.equal(formatBusinessTime("17:00"), "5 PM");
});

test("search-engine hours share the same regular schedule without inventing appointment times", () => {
  assert.equal(REGULAR_OPENING_HOURS.length, 5);
  assert.deepEqual(REGULAR_OPENING_HOURS.at(-1), {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: "https://schema.org/Saturday",
    opens: "12:00",
    closes: "16:00",
  });
  assert.ok(
    REGULAR_OPENING_HOURS.slice(0, 4).every(
      (hours) => hours.opens === "09:00" && hours.closes === "17:00",
    ),
  );
  assert.ok(
    !REGULAR_OPENING_HOURS.some((hours) =>
      /Monday|Sunday/.test(hours.dayOfWeek),
    ),
  );
  const dealer = dealershipSchema["@graph"].find(
    (item) => item["@type"] === "AutoDealer",
  );
  assert.deepEqual(dealer?.openingHoursSpecification, REGULAR_OPENING_HOURS);
  assert.ok(dealer?.description?.includes(APPOINTMENT_NOTE));
});

test("all visit-planning pages use the shared hours component and the appointment link has a target", () => {
  for (const page of [
    "app/layout.tsx",
    "app/page.tsx",
    "app/about/page.tsx",
    "app/contact/page.tsx",
    "app/areas-we-serve/page.tsx",
  ]) {
    assert.match(readFileSync(page, "utf8"), /<BusinessHours[\s/>]/, page);
  }
  assert.match(
    readFileSync("app/contact/page.tsx", "utf8"),
    /id="contact-form"/,
  );
  assert.match(
    readFileSync("app/_components/BusinessHours.tsx", "utf8"),
    /All times Eastern\./,
  );
});
