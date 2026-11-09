import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { galleryFields } from "../lib/customer-gallery";
import { canAccessView } from "../lib/permissions";
import { verifyCustomerGallery } from "../scripts/verify-customer-gallery.mjs";

test("gallery management is restricted to owners and managers; office photos cannot be featured as customers", () => {
  for (const role of ["owner", "manager", "finance", "sales", "unknown"])
    assert.equal(
      canAccessView(role, "Customer gallery"),
      ["owner", "manager"].includes(role),
    );
  const good = {
    caption: "",
    alt: "Customer beside their SUV",
    kind: "customer",
    featured: true,
    published: false,
    sort_order: 10,
    taken_year: null,
  };
  assert(galleryFields.safeParse(good).success);
  assert(!galleryFields.safeParse({ ...good, kind: "exterior" }).success);
  assert(!galleryFields.safeParse({ ...good, alt: "" }).success);
  assert(!galleryFields.safeParse({ ...good, sort_order: -1 }).success);
});

test("gallery migration seeds only the dealership, protects draft metadata, and keeps uploads private", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table dmcrm_orgs(id uuid primary key);
      insert into dmcrm_orgs values ('d5a1c100-0000-4000-8000-000000000001'),('d5a1c100-0000-4000-8000-000000000002');
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await db.exec(
      await fs.readFile(
        new URL("../db/041_customer_gallery.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec("begin");
    await verifyCustomerGallery(db);
    await db.exec("commit");
    const counts = await db.query<{ org_id: string; count: number }>(
      "select org_id,count(*)::int as count from dmcrm_site_photos group by org_id",
    );
    assert.equal(counts.rows.length, 1);
    assert.equal(counts.rows[0].count, 5);
    assert.equal(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='dmcrm-gallery'",
        )
      ).rows[0].public,
      false,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('anon','dmcrm_site_photos','SELECT') as allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('authenticated','dmcrm_site_photos','UPDATE') as allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      db.exec("update dmcrm_site_photos set kind='exterior' where featured"),
    );
    await assert.rejects(
      db.exec(
        "update dmcrm_site_photos set seed_path='/private/customer-licenses/a.webp'",
      ),
    );
    await db.exec(
      "update dmcrm_site_photos set published=false where sort_order=10",
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from dmcrm_site_photos where published",
        )
      ).rows[0].count,
      4,
    );
  } finally {
    await db.close();
  }
});
