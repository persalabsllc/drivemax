import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  documentMatches,
  documentMime,
  prepareDocumentSchema,
} from "../lib/vault-documents";
import { verifyDocumentVault } from "../scripts/verify-document-vault.mjs";
test("document search matches combined customer, stock, VIN, filename and notes", () => {
  const file = {
    name: "Signed sale.pdf",
    customer_name: "Jordan Ellis",
    stock_number: "DM2601",
    vin: "3FAHP08199R161851",
    vehicle_label: "2009 Ford Fusion",
    notes: "Title received",
  } as any;
  for (const q of ["jordan dm2601", "r161851", "signed TITLE", "ford fusion"])
    assert.equal(documentMatches(file, q), true);
  assert.equal(documentMatches(file, "jordan honda"), false);
  assert.equal(
    documentMime(new TextEncoder().encode("%PDF-1.7")),
    "application/pdf",
  );
  assert.equal(
    documentMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(documentMime(new TextEncoder().encode("<script>")), null);
  const input = {
    customer_id: null,
    opportunity_id: null,
    inventory_id: randomUUID(),
    name: "scan.pdf",
    kind: "title",
    document_date: "2026-10-27",
    size: 6 * 1024 * 1024,
    mime: "application/pdf",
  };
  assert(prepareDocumentSchema.safeParse(input).success);
  assert(
    !prepareDocumentSchema.safeParse({ ...input, inventory_id: null }).success,
  );
  assert(
    !prepareDocumentSchema.safeParse({ ...input, size: 26 * 1024 * 1024 })
      .success,
  );
  assert(
    !prepareDocumentSchema.safeParse({ ...input, mime: "text/html" }).success,
  );
});
test("vault migration and archive lifecycle preserve files, links, permissions and retention", async (t) => {
  const pg = new PGlite(),
    org = "d5a1c100-0000-4000-8000-000000000001",
    owner = "00000000-0000-4000-8000-000000000099",
    sales = "00000000-0000-4000-8000-000000000098",
    other = "00000000-0000-4000-8000-000000000097";
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cid = randomUUID(),
    oid = randomUUID(),
    legacy = randomUUID(),
    vid = randomUUID();
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
    );
    for (const f of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(
      `insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${other}','other@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Test Owner','owner');`,
    );
    for (const f of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter(
        (f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith("020_") && f < "024_",
      )
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales User','sales'),('${org}','${other}','Other User','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales User','sales@example.invalid','sales'),('${org}','${other}','Other User','other@example.invalid','sales');`,
    );
    const staff = (
      await one("select id from dmcrm_staff where user_id=$1", [sales])
    ).id;
    await pg.query(
      "insert into dmcrm_customers(id,org_id,name) values($1,$2,'Historical Customer')",
      [cid, org],
    );
    await pg.query(
      "insert into dmcrm_inventory(id,org_id,vin,stock_number,year,make,model,mileage,cost,price,acquired_on) values($1,$2,'3FAHP08199R161851','DM2601',2009,'Ford','Fusion',167485,1800,4500,'2026-01-01')",
      [vid, org],
    );
    await pg.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,inventory_id,assigned_to,vehicle_details) values($1,$2,$3,$4,$5,$6::jsonb)",
      [
        oid,
        org,
        cid,
        vid,
        staff,
        JSON.stringify({
          stock_number: "DM2601-ORIGINAL",
          vin: "3FAHP08199R161851",
          year: 2009,
          make: "Ford",
          model: "Fusion",
        }),
      ],
    );
    await pg.query(
      "insert into dmcrm_deal_files(id,org_id,customer_id,opportunity_id,name,kind,size,mime,path,created_at,created_by) values($1,$2,$3,$4,'Old packet.pdf','packet',100,'application/pdf',$5,'2025-01-01T18:00:00Z',$6)",
      [legacy, org, cid, oid, `${org}/${oid}/${legacy}.pdf`, owner],
    );
    await pg.exec(
      await fs.readFile(
        new URL("../db/020_document_vault.sql", import.meta.url),
        "utf8",
      ),
    );
    await t.test(
      "legacy profile files keep their id and historical stock, VIN and upload date",
      async () => {
        const f = await one(
          "select *,document_date::text date,retain_until::text retention from dmcrm_deal_files where id=$1",
          [legacy],
        );
        assert.equal(f.stock_number, "DM2601-ORIGINAL");
        assert.equal(f.vin, "3FAHP08199R161851");
        assert.equal(f.customer_name, "Historical Customer");
        assert.equal(f.date, "2025-01-01");
        assert.equal(f.retention, "2032-01-01");
        assert.equal(f.sha256, null);
      },
    );
    await t.test(
      "sales access requires the assigned opportunity; manager can file stock-only documents",
      async () => {
        const access = async (
          actor: string,
          opp: string | null,
          tenant = org,
        ) =>
          (
            await one("select dmcrm_document_access($1,$2,$3) allowed", [
              tenant,
              actor,
              opp,
            ])
          ).allowed;
        assert.equal(await access(sales, oid), true);
        assert.equal(await access(other, oid), false);
        assert.equal(await access(sales, null), false);
        assert.equal(await access(owner, null), true);
        assert.equal(await access(owner, oid, randomUUID()), false);
        const id = randomUUID();
        await pg.query(
          "insert into dmcrm_document_uploads(id,org_id,created_by,inventory_id,name,kind,size,mime,path,document_date) values($1,$2,$3,$4,'Auction invoice.pdf','purchase',6000000,'application/pdf',$5,current_date)",
          [id, org, owner, vid, `${org}/vault/${id}.pdf`],
        );
        await assert.rejects(
          one("select dmcrm_complete_document($1,$2,$3,$4)", [
            org,
            sales,
            id,
            "a".repeat(64),
          ]),
        );
        await one("select dmcrm_complete_document($1,$2,$3,$4)", [
          org,
          owner,
          id,
          "a".repeat(64),
        ]);
        const f = await one("select * from dmcrm_deal_files where id=$1", [id]);
        assert.equal(f.customer_id, null);
        assert.equal(f.inventory_id, vid);
        assert.equal(f.stock_number, "DM2601");
      },
    );
    await t.test(
      "immutable archive and later sale extend retention without shortening on unwind",
      async () => {
        await assert.rejects(
          pg.query("delete from dmcrm_deal_files where id=$1", [legacy]),
          /retention/,
        );
        await assert.rejects(
          pg.query("update dmcrm_deal_files set name='changed' where id=$1", [
            legacy,
          ]),
          /overwritten/,
        );
        await assert.rejects(
          pg.query(
            "update dmcrm_deal_files set retain_until='2031-01-01' where id=$1",
            [legacy],
          ),
          /shortened/,
        );
        await pg.query(
          "insert into dmcrm_sales(org_id,customer_id,opportunity_id,sold_on,snapshot) values($1,$2,$3,'2030-01-01','{}')",
          [org, cid, oid],
        );
        assert.equal(
          (
            await one(
              "select retain_until::text retention from dmcrm_deal_files where id=$1",
              [legacy],
            )
          ).retention,
          "2037-01-01",
        );
        await pg.query(
          "update dmcrm_sales set status='unwound' where opportunity_id=$1",
          [oid],
        );
        assert.equal(
          (
            await one(
              "select retain_until::text retention from dmcrm_deal_files where id=$1",
              [legacy],
            )
          ).retention,
          "2037-01-01",
        );
        await pg.query(
          "update dmcrm_inventory set deleted_at=now() where id=$1",
          [vid],
        );
        assert.equal(
          (
            await one("select stock_number from dmcrm_deal_files where id=$1", [
              legacy,
            ])
          ).stock_number,
          "DM2601-ORIGINAL",
        );
      },
    );
    await t.test(
      "a vehicle changed during upload cannot silently receive the wrong paperwork",
      async () => {
        const id = randomUUID();
        await pg.query(
          "insert into dmcrm_document_uploads(id,org_id,created_by,customer_id,opportunity_id,inventory_id,vehicle_snapshot,name,kind,size,mime,path,document_date) select $1,org_id,$2,customer_id,id,inventory_id,jsonb_build_object('vin',vehicle_details->>'vin','stock_number',vehicle_details->>'stock_number','label',vehicle_interest),'Stale scan.pdf','signed',100,'application/pdf',$3,current_date from dmcrm_opportunities where id=$4",
          [id, owner, `${org}/vault/${id}.pdf`, oid],
        );
        await pg.query(
          "update dmcrm_opportunities set inventory_id=null,vehicle_details=null,vehicle_interest='Changed vehicle' where id=$1",
          [oid],
        );
        await assert.rejects(
          one("select dmcrm_complete_document($1,$2,$3,$4)", [
            org,
            owner,
            id,
            "b".repeat(64),
          ]),
          /vehicle changed/,
        );
        assert.equal(
          (
            await one("select count(*) n from dmcrm_deal_files where id=$1", [
              id,
            ])
          ).n,
          0,
        );
      },
    );
    await t.test(
      "production verifier leaves no documents or fixtures behind",
      async () => {
        const before = (await one("select count(*) n from dmcrm_deal_files")).n;
        await pg.exec("begin");
        await verifyDocumentVault(pg);
        await pg.exec("commit");
        assert.equal(
          (await one("select count(*) n from dmcrm_deal_files")).n,
          before,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
