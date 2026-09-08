import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  absoluteUrl,
  breadcrumbSchema,
  buildSitemap,
  dealershipSchema,
  inventoryPageMetadata,
  jsonLd,
  pageMetadata,
  PUBLIC_PAGES,
  SERVICE_AREAS,
  SITE_URL,
  siteRobots,
} from "../lib/seo";

test("sitemap includes all public pages and excludes private stock", () => {
  const vehicle = {
    slug: "2018-test-car",
    status: "available" as const,
    updated_at: "2026-09-08T00:00:00Z",
    photos: ["vehicle/front.jpg", "vehicle/front.jpg"],
  };
  const urls = buildSitemap(
    [
      vehicle,
      vehicle,
      { ...vehicle, slug: "pending-car", status: "pending" },
      { ...vehicle, slug: "sold-car", status: "sold" },
      { ...vehicle, slug: "draft-car", status: "draft" },
      { ...vehicle, slug: "archived-car", status: "archived" },
    ],
    (path) => `https://images.example/${path}`,
  );
  assert.equal(urls.length, PUBLIC_PAGES.length + 3);
  assert.ok(urls.every((entry) => entry.url.startsWith(`${SITE_URL}/`)));
  assert.ok(
    !urls.some((entry) =>
      /draft-car|archived-car|control-room|\/api\//.test(entry.url),
    ),
  );
  const listing = urls.find((entry) => entry.url.endsWith(vehicle.slug));
  assert.equal(listing?.lastModified, vehicle.updated_at);
  assert.deepEqual(listing?.images, [
    "https://images.example/vehicle/front.jpg",
  ]);
  assert.ok(
    urls.slice(0, PUBLIC_PAGES.length).every((entry) => !entry.lastModified),
    "Do not manufacture static-page last-modified dates",
  );
});

test("sitemap omits invalid modification dates and encodes vehicle paths", () => {
  const urls = buildSitemap(
    [
      {
        slug: "test & car",
        status: "available",
        updated_at: "invalid",
        photos: [],
      },
    ],
    (path) => path,
  );
  assert.equal(urls.at(-1)?.url, `${SITE_URL}/inventory/test%20%26%20car`);
  assert.equal(urls.at(-1)?.lastModified, undefined);
});

test("public sitemap navigation points to real pages", () => {
  for (const page of PUBLIC_PAGES) {
    assert.ok(
      existsSync(`app${page.path === "/" ? "" : page.path}/page.tsx`),
      page.path,
    );
  }
  assert.equal(
    new Set(PUBLIC_PAGES.map((page) => page.path)).size,
    PUBLIC_PAGES.length,
  );
});

test("robots allows public production crawling and advertises the canonical sitemap", () => {
  assert.deepEqual(siteRobots(false), {
    rules: { userAgent: "*", allow: "/", disallow: ["/control-room", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  });
  assert.deepEqual(siteRobots(true), {
    rules: { userAgent: "*", disallow: "/" },
  });
});

test("page metadata has matching canonical and social URLs", () => {
  const metadata = pageMetadata({
    title: "Used cars",
    description: "Used cars in New Bern",
    path: "/inventory/test-car",
    image: "https://images.example/test.jpg",
  });
  assert.equal(
    metadata.alternates?.canonical,
    `${SITE_URL}/inventory/test-car`,
  );
  assert.deepEqual(metadata.title, {
    absolute: "Used cars | Drive Max Used Cars",
  });
  assert.equal(metadata.openGraph?.url, metadata.alternates?.canonical);
  assert.equal(metadata.openGraph?.description, metadata.description);
  assert.equal(metadata.twitter?.description, metadata.description);
  assert.deepEqual(metadata.openGraph?.images, [
    { url: "https://images.example/test.jpg", alt: "Used cars" },
  ]);
});

test("inventory filters are noindex but pagination has its own canonical", () => {
  const filtered = inventoryPageMetadata({ q: "Toyota", page: "2" });
  assert.deepEqual(filtered.robots, { index: false, follow: true });
  assert.equal(filtered.alternates?.canonical, `${SITE_URL}/inventory`);
  assert.equal(
    inventoryPageMetadata({ q: "", body: "", max: "", page: "2" }).alternates
      ?.canonical,
    `${SITE_URL}/inventory?page=2`,
  );
  assert.equal(
    inventoryPageMetadata({ soldPage: "3" }).alternates?.canonical,
    `${SITE_URL}/inventory?soldPage=3`,
  );
  assert.equal(
    inventoryPageMetadata({ page: "Infinity", soldPage: "nope" }).alternates
      ?.canonical,
    `${SITE_URL}/inventory`,
  );
});

test("business schema represents one real location and all requested communities", () => {
  const business = dealershipSchema["@graph"].find(
    (item) => item["@type"] === "AutoDealer",
  );
  assert.equal(business?.address?.addressLocality, "New Bern");
  assert.equal(business?.areaServed?.length, 9);
  const copy =
    readFileSync("app/areas-we-serve/page.tsx", "utf8") +
    readFileSync("app/page.tsx", "utf8");
  for (const area of SERVICE_AREAS) assert.ok(copy.includes(area), area);
  assert.equal(business?.email, "sales@drivemaxusedcars.com");
  assert.ok(!("aggregateRating" in business!), "Do not invent review ratings");
});

test("structured data is script-safe and breadcrumb positions are correct", () => {
  const serialized = jsonLd({
    description: "</script><script>alert(1)</script>",
  });
  assert.ok(!serialized.includes("<"));
  assert.equal(
    JSON.parse(serialized).description,
    "</script><script>alert(1)</script>",
  );
  const breadcrumbs = breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "Inventory", path: "/inventory" },
  ]);
  assert.deepEqual(
    breadcrumbs.itemListElement.map((item) => item.position),
    [1, 2],
  );
  assert.equal(breadcrumbs.itemListElement[0].item, absoluteUrl("/"));
});

test("Control Room retains authentication and noindex protections", () => {
  const layout = readFileSync("app/control-room/layout.tsx", "utf8");
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(layout, /index:\s*false/);
  assert.match(proxy, /X-Robots-Tag/i);
  assert.match(proxy, /noindex/);
});
