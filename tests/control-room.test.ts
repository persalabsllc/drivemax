import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  inventoryMatches,
  vehicleSchema,
  leadSchema,
  vehicleSlug,
  schemaAvailability,
  type Vehicle,
} from "../lib/inventory";
import { replyLeadId, mailbox } from "../lib/email-routing";

const id = "0e400b44-3e80-4d19-a9f4-4e283be977d6";
const vehicle = {
  id,
  slug: "2020-toyota-camry-test",
  year: 2020,
  make: "Toyota",
  model: "Camry",
  trim: "LE",
  vin: "4T1B11HK0KU123456",
  stock_number: "DM001",
  miles: 72000,
  internet_price: 17995,
  body_style: "Sedan",
  transmission: "Automatic",
  fuel: "Gasoline",
  exterior: "Silver",
  drivetrain: "FWD",
  description: "A clean, comfortable sedan ready for a closer look.",
  financing: "Ask about financing options.",
  features: ["Backup camera"],
  photos: [`${id}/test.webp`],
  featured: true,
  status: "available",
  sold_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as Vehicle;
test("available searches exclude sold, pending, draft, and archived even when featured", () => {
  assert.equal(
    inventoryMatches(vehicle, "Toyota Camry", "Sedan", "20000"),
    true,
  );
  for (const status of ["sold", "pending", "draft", "archived"] as const)
    assert.equal(inventoryMatches({ ...vehicle, status }, "Camry"), false);
  assert.equal(inventoryMatches(vehicle, "Camry", "", "10000"), false);
  assert.equal(inventoryMatches(vehicle, "Camry", "Truck"), false);
});
test("published listings require real photos, description, valid VIN, and price", () => {
  assert.equal(vehicleSchema.safeParse(vehicle).success, true);
  for (const patch of [
    { vin: "invalid" },
    { internet_price: -10 },
    { miles: -1 },
    { photos: [] },
    { description: "" },
  ])
    assert.equal(
      vehicleSchema.safeParse({ ...vehicle, ...patch }).success,
      false,
    );
  assert.equal(
    vehicleSchema.safeParse({
      ...vehicle,
      status: "draft",
      photos: [],
      description: "",
    }).success,
    true,
  );
  assert.equal(schemaAvailability("sold"), "https://schema.org/SoldOut");
  assert.match(vehicleSlug(vehicle, id), /^2020-toyota-camry-le-0e400b44$/);
});
test("inquiry validation enforces the chosen reply method", () => {
  const lead = {
    requestId: id,
    kind: "vehicle",
    name: "Test Customer",
    email: "customer@example.com",
    phone: "",
    preferredContact: "Email",
  };
  assert.equal(leadSchema.safeParse(lead).success, true);
  assert.equal(leadSchema.safeParse({ ...lead, email: "" }).success, false);
  assert.equal(
    leadSchema.safeParse({ ...lead, preferredContact: "Phone call" }).success,
    false,
  );
  assert.equal(
    leadSchema.safeParse({
      ...lead,
      preferredContact: "Phone call",
      phone: "252-555-0100",
    }).success,
    true,
  );
});
test("reply routing rejects unrelated domains and ambiguous lead recipients", () => {
  assert.equal(
    mailbox("Customer <CUSTOMER@example.com>"),
    "customer@example.com",
  );
  assert.equal(
    replyLeadId([`lead+${id}@replies.example.com`], "replies.example.com"),
    id,
  );
  assert.equal(
    replyLeadId([`lead+${id}@attacker.example`], "replies.example.com"),
    null,
  );
  assert.equal(
    replyLeadId(
      [
        `lead+${id}@replies.example.com`,
        `lead+00000000-0000-4000-a000-000000000000@replies.example.com`,
      ],
      "replies.example.com",
    ),
    null,
  );
});
test("Postgres migration: persistence, idempotent intake, sold URL stability, and private table access", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    await pg.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609070001_control_room.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const payload = {
      requestId: id,
      kind: "vehicle",
      name: "Test Customer",
      email: "customer@example.com",
      phone: "",
      preferredContact: "Email",
      message: "Is this available?",
      website: "",
    };
    await pg.query("select public.submit_lead($1::jsonb)", [
      JSON.stringify(payload),
    ]);
    await pg.query("select public.submit_lead($1::jsonb)", [
      JSON.stringify(payload),
    ]);
    assert.equal(
      (
        await pg.query<{ count: number }>(
          "select count(*)::int as count from public.leads",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await pg.query<{ count: number }>(
          "select count(*)::int as count from public.messages",
        )
      ).rows[0].count,
      1,
    );
    for (let i = 0; i < 3; i++) {
      const r = await pg.query<{ allowed: boolean }>(
        "select public.take_request_slot($1,2) as allowed",
        ["test"],
      );
      assert.equal(r.rows[0].allowed, i < 2);
    }
    await pg.query(
      `insert into public.vehicles(id,slug,year,make,model,vin,stock_number,miles,internet_price,description,photos,status) values($1,'permanent-url',2020,'Toyota','Camry','4T1B11HK0KU123456','DM001',72000,17995,'A clean sedan with a complete description.',array['photo.webp'],'available')`,
      [id],
    );
    await pg.query(
      `update public.vehicles set status='sold',slug='attempted-change' where id=$1`,
      [id],
    );
    const row = (
      await pg.query<{ slug: string; status: string; sold_at: string }>(
        "select slug,status,sold_at from public.vehicles",
      )
    ).rows[0];
    assert.equal(row.slug, "permanent-url");
    assert.equal(row.status, "sold");
    assert.ok(row.sold_at);
    await pg.exec("set role authenticated");
    for (const table of [
      "staff",
      "vehicles",
      "leads",
      "messages",
      "vehicle_assets",
    ])
      await assert.rejects(
        pg.query(`select * from public.${table}`),
        /permission denied/,
      );
    await assert.rejects(
      pg.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify(payload),
      ]),
      /permission denied/,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});
