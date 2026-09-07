import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { leadSchema } from "../lib/inventory";
import {
  captureVehicleInquiry,
  updateVehicleAssignment,
  type LeadVehicle,
} from "../lib/lead-vehicles";
import { leadLabel } from "../lib/purchase-requests";

const original: LeadVehicle = {
  id: "0e400b44-3e80-4d19-a9f4-4e283be977d6",
  slug: "test-honda",
  year: 2003,
  make: "Honda",
  model: "Accord",
  trim: "EX",
  vin: "1HGCM82633A004352",
  stock_number: "TEST001",
  miles: 85000,
  status: "available",
};
const replacement: LeadVehicle = {
  ...original,
  id: "7f56bb23-3eb1-4c20-9f44-e2d017278162",
  slug: "test-toyota",
  make: "Toyota",
  model: "Camry",
  year: 2020,
  vin: "4T1B11HK0KU123456",
  stock_number: "TEST002",
  miles: 0,
};
const request = {
  requestId: "cb18fd42-1024-49cd-b4f7-0be306958315",
  kind: "vehicle",
  purpose: "test-drive",
  vehicleId: original.id,
  name: "TEST Test Drive",
  email: "test@example.com",
  preferredContact: "Email",
  preferredVisit: "Saturday morning",
  message: "Please confirm availability.",
};
const now = "2026-09-07T19:00:00.000Z";

test("test-drive requests require a specific car and capture trusted inventory details", () => {
  for (const patch of [
    { vehicleId: "" },
    { vehicleId: undefined },
    { kind: "contact" },
    { preferredVisit: "x".repeat(161) },
  ])
    assert.equal(leadSchema.safeParse({ ...request, ...patch }).success, false);
  const parsed = leadSchema.parse({
    ...request,
    originalVehicleVin: "FORGED",
    originalVehicleMiles: "1",
    assignedVehicleId: replacement.id,
  });
  const captured = captureVehicleInquiry(parsed, original, now);
  assert.equal(captured.originalVehicleVin, original.vin);
  assert.equal(captured.originalVehicleMiles, "85000");
  assert.equal(captured.assignedVehicleId, original.id);
  assert.equal(captured.vehicleId, original.id);
  assert.equal(captured.preferredVisit, "Saturday morning");
  assert.match(captured.message, /85,000 miles/);
  assert.match(captured.message, /not confirmed/);
  assert.equal(
    leadLabel({ kind: "vehicle", details: { purpose: captured.purpose! } }),
    "Test-drive request",
  );
});

test("sold and pending cars cannot accept test-drive requests and retain appropriate inquiry intent", () => {
  const parsed = leadSchema.parse(request);
  for (const status of ["sold", "pending", "draft", "archived"] as const)
    assert.throws(() =>
      captureVehicleInquiry(parsed, { ...original, status }, now),
    );
  const generic = {
    ...parsed,
    purpose: undefined,
    preferredVisit: "Saturday morning",
  };
  const sold = captureVehicleInquiry(
    generic,
    { ...original, status: "sold" },
    now,
  );
  assert.equal(sold.purpose, "similar-vehicle");
  assert.equal(sold.preferredVisit, "");
  assert.match(sold.message, /similar to this sold listing/);
  const pending = captureVehicleInquiry(
    generic,
    { ...original, status: "pending" },
    now,
  );
  assert.equal(pending.purpose, "vehicle-update");
});

test("reassigning and clearing a car preserve original VIN and mileage, including zero miles", () => {
  const captured = captureVehicleInquiry(
    leadSchema.parse(request),
    original,
    now,
  );
  const details = {
    originalVehicleId: captured.originalVehicleId,
    originalVehicleTitle: captured.originalVehicleTitle,
    originalVehicleVin: captured.originalVehicleVin,
    originalVehicleMiles: captured.originalVehicleMiles,
    assignedVehicleId: original.id,
    assignedVehicleMiles: "85000",
    preferredVisit: "Saturday morning",
    purpose: "test-drive",
  };
  const changed = updateVehicleAssignment(details, original, replacement, now);
  assert.equal(changed.originalVehicleVin, original.vin);
  assert.equal(changed.originalVehicleMiles, "85000");
  assert.equal(changed.assignedVehicleVin, replacement.vin);
  assert.equal(changed.assignedVehicleMiles, "0");
  assert.equal(changed.preferredVisit, details.preferredVisit);
  const cleared = updateVehicleAssignment(changed, replacement, null, now);
  assert.equal(cleared.assignedVehicleId, undefined);
  assert.equal(cleared.originalVehicleId, original.id);
  assert.equal(details.assignedVehicleId, original.id);
  const sameCar = updateVehicleAssignment(
    changed,
    replacement,
    { ...replacement, miles: 15 },
    now,
  );
  assert.equal(sameCar.assignedVehicleMiles, "0");
  const legacy = updateVehicleAssignment(
    { reason: "Legacy inquiry" },
    original,
    replacement,
    now,
  );
  assert.equal(legacy.originalVehicleId, original.id);
});

test("CRM persistence links requests, retains snapshots after reassignment, and counts leads per current car", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
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
    for (const v of [original, replacement])
      await pg.query(
        "insert into public.vehicles(id,slug,year,make,model,trim,vin,stock_number,miles,internet_price,description,photos,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,5000,'A test-only vehicle for database verification.',array['test.webp'],'available')",
        [
          v.id,
          v.slug,
          v.year,
          v.make,
          v.model,
          v.trim,
          v.vin,
          v.stock_number,
          v.miles,
        ],
      );
    const captured = captureVehicleInquiry(
      leadSchema.parse(request),
      original,
      now,
    );
    for (let attempt = 0; attempt < 2; attempt++)
      await pg.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify(captured),
      ]);
    const lead = (
      await pg.query<{
        details: Record<string, string>;
        updated_at: string;
        status: string;
      }>("select details,updated_at,status from public.leads where id=$1", [
        request.requestId,
      ])
    ).rows[0];
    assert.equal(lead.status, "new");
    assert.equal(lead.details.originalVehicleVin, original.vin);
    assert.equal(lead.details.preferredVisit, "Saturday morning");
    const changed = updateVehicleAssignment(
      lead.details,
      original,
      replacement,
      now,
    );
    await pg.query(
      "update public.leads set vehicle_id=$1,details=$2::jsonb,updated_at=$3 where id=$4 and updated_at=$5",
      [
        replacement.id,
        JSON.stringify(changed),
        now,
        request.requestId,
        lead.updated_at,
      ],
    );
    const stale = await pg.query(
      "update public.leads set vehicle_id=$1 where id=$2 and updated_at=$3 returning id",
      [original.id, request.requestId, lead.updated_at],
    );
    assert.equal(stale.rows.length, 0);
    const joined = (
      await pg.query<{
        vin: string;
        miles: number;
        details: Record<string, string>;
      }>(
        "select v.vin,v.miles,l.details from public.leads l join public.vehicles v on v.id=l.vehicle_id where l.id=$1",
        [request.requestId],
      )
    ).rows[0];
    assert.equal(joined.vin, replacement.vin);
    assert.equal(joined.miles, 0);
    assert.equal(joined.details.originalVehicleVin, original.vin);
    const counts = (
      await pg.query<{ id: string; total: number; open: number }>(
        "select v.id,count(l.id)::int as total,count(l.id) filter(where l.status in ('new','contacted','appointment'))::int as open from public.vehicles v left join public.leads l on l.vehicle_id=v.id group by v.id order by v.id",
      )
    ).rows;
    assert.equal(counts.find((c) => c.id === original.id)?.total, 0);
    assert.equal(counts.find((c) => c.id === replacement.id)?.open, 1);
    assert.equal(
      (
        await pg.query("select * from public.messages where lead_id=$1", [
          request.requestId,
        ])
      ).rows.length,
      1,
    );
    await pg.query("update public.leads set status='won' where id=$1", [
      request.requestId,
    ]);
    assert.equal(
      (
        await pg.query(
          "select id from public.leads where vehicle_id=$1 and status in ('new','contacted','appointment')",
          [replacement.id],
        )
      ).rows.length,
      0,
    );
    await pg.exec("set role anon");
    await assert.rejects(
      pg.query("select * from public.leads"),
      /permission denied/,
    );
  } finally {
    await pg.close();
  }
});
