import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { activityQuerySchema } from "../lib/website-activity";
import { verifyWebsiteActivity } from "../scripts/verify-website-activity.mjs";
test("activity report dates and IDs are bounded", () => {
  assert(
    activityQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31" })
      .success,
  );
  for (const query of [
    { from: "2026-02-30", to: "2026-10-31" },
    { from: "2026-01-01", to: "2026-12-31" },
    { from: "2026-10-31", to: "2026-10-01" },
    { from: "2026-10-01", to: "2026-10-31", session: "other" },
    { from: "2026-10-01", to: "2026-10-31", offset: -1 },
  ])
    assert.equal(activityQuerySchema.safeParse(query).success, false);
});
test("analytics SQL: safe ingestion, deduplication, real conversions, assigned access, sessions and retention", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const file of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const owner = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'activity-owner@example.invalid')",
      [owner],
    );
    await db.query(
      "insert into staff(id,email,name,role) values($1,'activity-owner@example.invalid','Fictional Owner','owner')",
      [owner],
    );
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await db.exec("begin");
    await verifyWebsiteActivity(db);
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});
