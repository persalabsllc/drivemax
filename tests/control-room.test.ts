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
test("inquiry validation requires a phone number for every reply method", () => {
  const lead = {
    requestId: id,
    kind: "vehicle",
    name: "Test Customer",
    email: "customer@example.com",
    phone: "(252) 555-0100",
    preferredContact: "Email",
  };
  assert.equal(leadSchema.safeParse(lead).success, true);
  assert.equal(leadSchema.safeParse({ ...lead, email: "" }).success, false);
  for (const kind of ["vehicle", "contact", "finance", "employment"])
    for (const preferredContact of ["Email", "Phone call", "Text message"])
      for (const phone of [
        undefined,
        "",
        " ",
        "252555",
        "abc2525550100",
        "1".repeat(16),
      ]) {
        const result = leadSchema.safeParse({
          ...lead,
          kind,
          preferredContact,
          phone,
          message: "Test inquiry",
          position: "Sales",
          experience: "Test experience",
        });
        assert.equal(
          result.success,
          false,
          `${kind} / ${preferredContact} / ${phone}`,
        );
        if (!result.success)
          assert.ok(
            result.error.issues.some((issue) => issue.path[0] === "phone"),
          );
      }
  for (const phone of [
    "2525550100",
    "252-555-0100",
    "+1 (252) 555-0100",
    "+44 20 7946 0123",
  ])
    assert.equal(leadSchema.safeParse({ ...lead, phone }).success, true, phone);
  assert.equal(
    leadSchema.safeParse({
      ...lead,
      preferredContact: "Phone call",
      phone: "252-555-0100",
      email: "",
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
    const purchaseId = "7f56bb23-3eb1-4c20-9f44-e2d017278162";
    const purchasePayload = {
      ...payload,
      requestId: purchaseId,
      purpose: "purchase-offer",
      sellerVin: "1HGCM82633A004352",
      sellerMiles: "85000",
      condition: "Good",
      titleStatus: "Clean title",
      askingPrice: "4500",
      message: "Purchase offer requested. Recent tires.",
    };
    for (let i = 0; i < 2; i++)
      await pg.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify(purchasePayload),
      ]);
    const purchase = (
      await pg.query<{
        details: Record<string, string>;
        vehicle_id: string | null;
      }>("select details,vehicle_id from public.leads where id=$1", [
        purchaseId,
      ])
    ).rows[0];
    assert.equal(purchase.details.purpose, "purchase-offer");
    assert.equal(purchase.details.sellerVin, purchasePayload.sellerVin);
    assert.equal(purchase.details.sellerMiles, "85000");
    assert.equal(purchase.details.askingPrice, "4500");
    assert.equal(purchase.vehicle_id, null);
    const purchaseMessages = await pg.query<{ body: string }>(
      "select body from public.messages where lead_id=$1",
      [purchaseId],
    );
    assert.equal(purchaseMessages.rows.length, 1);
    assert.equal(purchaseMessages.rows[0].body, purchasePayload.message);
    assert.equal(
      (
        await pg.query(
          "select id from public.leads where details->>'purpose'='purchase-offer'",
        )
      ).rows.length,
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
