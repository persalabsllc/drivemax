import test from "node:test";
import assert from "node:assert/strict";
import { activityLocationFromHeaders } from "../lib/website-activity-location";

test("host geolocation records only a decoded city, region and country", () => {
  const headers = new Headers({
    "x-vercel-ip-city": "Myrtle%20Beach",
    "x-vercel-ip-country-region": "SC",
    "x-vercel-ip-country": "US",
    "x-vercel-ip-latitude": "33.7",
    "x-vercel-ip-longitude": "-78.9",
    "x-vercel-ip-postal-code": "29577",
    "x-forwarded-for": "192.0.2.1",
  });
  assert.deepEqual(activityLocationFromHeaders(headers, true), {
    city: "Myrtle Beach",
    region: "SC",
    country: "US",
  });
  headers.set("x-vercel-ip-city", "S%C3%A3o%20Paulo");
  headers.set("x-vercel-ip-country-region", "SP");
  headers.set("x-vercel-ip-country", "BR");
  assert.deepEqual(activityLocationFromHeaders(headers, true), {
    city: "São Paulo",
    region: "SP",
    country: "BR",
  });
});

test("missing, unmanaged or malformed location never invents a city", () => {
  const empty = { city: null, region: null, country: null };
  assert.deepEqual(activityLocationFromHeaders(new Headers(), true), empty);
  const headers = new Headers({
    "x-vercel-ip-city": "Raleigh",
    "x-vercel-ip-country-region": "NC",
    "x-vercel-ip-country": "US",
  });
  assert.deepEqual(activityLocationFromHeaders(headers, false), empty);
  for (const city of [
    "%E0%A4%A",
    "%00Raleigh",
    "<script>",
    "x".repeat(121),
    "unknown",
    "",
  ]) {
    headers.set("x-vercel-ip-city", city);
    assert.deepEqual(activityLocationFromHeaders(headers, true), {
      city: null,
      region: "NC",
      country: "US",
    });
  }
  headers.set("x-vercel-ip-country-region", "North Carolina");
  assert.equal(activityLocationFromHeaders(headers, true).region, null);
  for (const country of ["XX", "United States", ""]) {
    headers.set("x-vercel-ip-country", country);
    assert.deepEqual(activityLocationFromHeaders(headers, true), empty);
  }
});
