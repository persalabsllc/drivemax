import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import fixture from "./fixtures/license-barcode.json";
import { parseLicenseBarcode, licenseCropSchema } from "../lib/license-scan";
import { createBarcodeDecoder } from "../lib/vin-camera";
import { verifyCustomerLicenses } from "../scripts/verify-customer-licenses.mjs";
import { appendLicenseCopies } from "../lib/license-print";

function payload(fields: string[], issuer = "636004", version = "08") {
  const body = `DL${fields.join("\n")}\r`;
  return `@\n\x1e\rANSI ${issuer}${version}0001DL0031${String(body.length).padStart(4, "0")}${body}`;
}
const fields = [
  "DAQTEST-ONLY-42",
  "DCSO'NEIL-SMITH",
  "DACJORDAN",
  "DADCASE",
  "DCUJR",
  "DBB02031990",
  "DAG100 DCS ROAD",
  "DAHAPT 4",
  "DAINEW BERN",
  "DAJNC",
  "DAK028010000",
  "DCGUSA",
];
test("license fields preserve names, leading zeros and address boundaries; issuer is not guessed from residence", () => {
  const result = parseLicenseBarcode(payload(fields, "636000"))!;
  assert.equal(result.person.license_state, "VA");
  assert.equal(result.person.state, "NC");
  assert.equal(result.birthday, "1990-02-03");
  assert.equal(result.person.last_name, "O'NEIL-SMITH");
  assert.equal(result.person.middle_name, "CASE");
  assert.equal(result.person.address1, "100 DCS ROAD");
  assert.equal(result.person.address2, "APT 4");
  assert.equal(result.person.zip, "02801");
  const canada = parseLicenseBarcode(
    payload(
      fields.map((v) =>
        v === "DBB02031990"
          ? "DBB19900203"
          : v === "DCGUSA"
            ? "DCGCAN"
            : v === "DAK028010000"
              ? "DAKM5V 2T6"
              : v,
      ),
      "636012",
    ),
  )!;
  assert.equal(canada.birthday, "1990-02-03");
  assert.equal(canada.person.zip, "M5V 2T6");
  const old = parseLicenseBarcode(
    payload(
      ["DAQTEST", "DAAFIXTURE,JORDAN,CASE", "DBB19900203", "DAJNC"],
      "636004",
      "01",
    ),
  )!;
  assert.equal(old.person.first_name, "JORDAN");
  assert.equal(old.person.middle_name, "CASE");
  const truncated = parseLicenseBarcode(
    payload([...fields, "DDFT", "DBA01012020"]),
  )!;
  assert.equal(truncated.warnings.length, 2);
});
test("malformed, conflicting, incomplete, impossible-date and unrelated barcodes are rejected", () => {
  for (const input of [
    "",
    JSON.stringify({ license: "123" }),
    "https://example.invalid",
    "X".repeat(16001),
    payload(fields.filter((v) => !v.startsWith("DAQ"))),
    payload(fields.map((v) => (v.startsWith("DBB") ? "DBB02301990" : v))),
    payload(fields.map((v) => (v.startsWith("DBB") ? "DBB01012100" : v))),
    payload([...fields, "DAQOTHER"]),
  ])
    assert.equal(parseLicenseBarcode(input), null);
  assert.equal(
    licenseCropSchema.safeParse({ x: 0.95, y: 0, width: 0.2, height: 0.2 })
      .success,
    false,
  );
  assert.equal(
    licenseCropSchema.safeParse({ x: 0, y: 0, width: 0.2, height: 0.2 })
      .success,
    true,
  );
});
test("real PDF417 barcode pixels decode locally, including a rotated image", async () => {
  const { width, height } = fixture;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const row of fixture.rows)
    for (let y = row.y; y < row.y + row.height; y++)
      for (const [x, length] of row.bars)
        for (let dx = 0; dx < length; dx++) {
          const n = (y * width + x + dx) * 4;
          rgba[n] = rgba[n + 1] = rgba[n + 2] = 0;
        }
  const canvas = (pixels: Uint8ClampedArray, w: number, h: number) =>
    ({
      width: w,
      height: h,
      getContext: () => ({ getImageData: () => ({ data: pixels }) }),
    }) as unknown as HTMLCanvasElement;
  const decode = await createBarcodeDecoder("pdf417");
  const decoded = decode(canvas(rgba, width, height), true);
  assert.equal(decoded, fixture.text);
  assert.equal(
    parseLicenseBarcode(decoded!)?.person.license_number,
    "TEST-ONLY-0042",
  );
  const rotated = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rotated.set(
        rgba.subarray((y * width + x) * 4, (y * width + x + 1) * 4),
        (x * height + height - y - 1) * 4,
      );
  assert.equal(decode(canvas(rotated, height, width), true), fixture.text);
});
test("license copies append to the existing packet without replacing its pages", async () => {
  // A tiny, synthetic JPEG; no customer identity data is used in this test.
  const jpg = new Uint8Array(
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z",
      "base64",
    ),
  );
  const base = await PDFDocument.create();
  base.addPage([612, 792]);
  const output = await appendLicenseCopies(await base.save(), [
    { bytes: jpg, name: "Synthetic Test", capturedAt: "2026-10-28T12:00:00Z" },
  ]);
  const doc = await PDFDocument.load(output);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(doc.getPages()[1].getSize(), { width: 612, height: 792 });
});
test("license archive verifies authorization, retry safety, retention, immutable crop and customer merges", async () => {
  const pg = new PGlite(),
    owner = randomUUID(),
    sales = randomUUID(),
    org = "d5a1c100-0000-4000-8000-000000000001";
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const file of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    await pg.query(
      "insert into auth.users(id,email) values($1,'license-owner@example.invalid'),($2,'license-sales@example.invalid')",
      [owner, sales],
    );
    await pg.query(
      "insert into staff(id,email,name,role) values($1,'license-owner@example.invalid','Test Owner','owner')",
      [owner],
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await pg.query(
      "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,'Test Sales','sales');",
      [org, sales],
    );
    await pg.query(
      "insert into dmcrm_staff(org_id,user_id,name,email,role) values($1,$2,'Test Sales','license-sales@example.invalid','sales')",
      [org, sales],
    );
    await pg.exec("begin");
    // Production PostgreSQL timestamps retain microseconds; JS Date does not.
    await pg.exec(
      "alter table dmcrm_customers alter column updated_at set default '2026-10-28T12:34:56.123456Z'::timestamptz",
    );
    await verifyCustomerLicenses(pg);
    await pg.exec("commit");
  } finally {
    await pg.close();
  }
});
