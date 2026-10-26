import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryView } from "../components/Inventory";
import { demoWorkspace } from "../lib/demo";
import { inventorySchema } from "../lib/vehicles";
import {
  websiteInventoryLabel,
  websiteInventoryIssue,
  websiteListingEditorUrl,
  type WebsiteInventoryLink,
} from "../lib/website-inventory";
import { verifyInventoryWebsite } from "../scripts/verify-inventory-website.mjs";
import { verifyWebsiteIntake } from "../scripts/verify-website-intake.mjs";

const org = "d5a1c100-0000-4000-8000-000000000001",
  owner = "00000000-0000-4000-8000-000000000099",
  otherOrg = "00000000-0000-4000-8000-000000000097";
const vehicle = (extra: Record<string, unknown> = {}) => ({
  vin: "3FA6P0H72LR100001",
  stock_number: "CRM100",
  year: 2020,
  make: "Ford",
  model: "Fusion",
  trim: "SE",
  mileage: 45000,
  color: "Blue",
  cost: 7000,
  recon: 500,
  price: 10000,
  acquired_on: "2026-01-01",
  status: "in_stock",
  ...extra,
});

test("CRM inventory reaches Control Room drafts and retains separate merchandising and safe stock lifecycle", async (t) => {
  const pg = new PGlite();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const command = async (p: unknown, organization = org, actor = owner) =>
    (
      await one("select dmcrm_command($1,$2,$3::jsonb) id", [
        organization,
        actor,
        JSON.stringify(p),
      ])
    ).id as string;
  const queue = (id: string) =>
    one("select * from dmcrm_inventory_website where inventory_id=$1", [id]);
  const website = (id: string) =>
    one(
      "select v.* from dmcrm_inventory_website q join vehicles v on v.id=q.website_id where q.inventory_id=$1",
      [id],
    );
  const feed = async () =>
    (await one("select dmcrm_attention($1,$2) feed", [org, owner])).feed;
  const save = (v: ReturnType<typeof vehicle>, id?: string) =>
    command({ type: "save_inventory", ...(id ? { id } : {}), vehicle: v });
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of [
      "202609070001_control_room.sql",
      "202610190001_lead_notifications.sql",
    ])
      await pg.exec(
        await fs.readFile(
          new URL("../../../supabase/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    await pg.exec(
      `insert into auth.users(id,email) values('${owner}','owner@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Test Owner','owner');`,
    );
    for (const name of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 12)
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + name, import.meta.url), "utf8"),
      );
    const existingWebsite =
      await one(`insert into vehicles(slug,vin,stock_number,year,make,model,miles,internet_price,description,photos,status)
   values('existing-fusion','3FA6P0H72LR100001','OLD100',2020,'Ford','Fusion',44000,13500,'A carefully written website description.',array['existing/one.webp'],'available') returning *`);
    const existingCRM = await save(vehicle());
    const zeroCRM = await save(
      vehicle({ vin: "3FA6P0H72LR100002", stock_number: "CRM101", price: 0 }),
    );
    const oldSold = await save(
      vehicle({
        vin: "3FA6P0H72LR100003",
        stock_number: "OLD-SOLD",
        status: "sold",
      }),
    );
    await pg.exec(
      await fs.readFile(
        new URL("../db/013_inventory_website_sync.sql", import.meta.url),
        "utf8",
      ),
    );

    await t.test(
      "existing VINs link once; existing pricing, description, photos and URL survive the backfill",
      async () => {
        const w = await website(existingCRM);
        assert.equal(w.id, existingWebsite.id);
        assert.equal(w.slug, "existing-fusion");
        assert.equal(w.status, "available");
        assert.equal(Number(w.internet_price), 13500);
        assert.deepEqual(w.photos, ["existing/one.webp"]);
        assert.equal(w.description, existingWebsite.description);
        assert.equal(w.stock_number, "CRM100");
        assert.equal(w.miles, 45000);
        assert.equal(
          Number(
            (await one("select count(*) n from vehicles where vin=$1", [w.vin]))
              .n,
          ),
          1,
        );
        assert.equal(await queue(oldSold), undefined);
      },
    );
    await t.test(
      "zero-price stock creates an unpublished draft; publishing still requires a real price, description and photos",
      async () => {
        const w = await website(zeroCRM);
        assert.equal(w.status, "draft");
        assert.equal(Number(w.internet_price), 0);
        assert.deepEqual(w.photos, []);
        assert.equal(w.description, "");
        await assert.rejects(
          pg.query(
            "update vehicles set status='available',photos=array['fixture/one.webp'],description='A complete vehicle description.' where id=$1",
            [w.id],
          ),
          /check constraint/,
        );
        await assert.rejects(
          pg.query(
            "update vehicles set status='available',internet_price=10000 where id=$1",
            [w.id],
          ),
          /check constraint/,
        );
        assert.equal((await website(zeroCRM)).status, "draft");
        assert.equal(
          await one(
            "select id from vehicles where id=$1 and status in('available','pending','sold')",
            [w.id],
          ),
          undefined,
        );
      },
    );
    let added: string;
    let originalWebsite: any;
    await t.test(
      "the authenticated inventory command copies public facts only and retries do not duplicate a listing",
      async () => {
        await pg.exec("set role service_role");
        added = await save(
          vehicle({ vin: "3FA6P0H72LR100004", stock_number: "CRM104" }),
        );
        await pg.exec("reset role");
        originalWebsite = await website(added);
        assert.equal(originalWebsite.status, "draft");
        assert.equal(originalWebsite.vin, "3FA6P0H72LR100004");
        assert.equal(originalWebsite.exterior, "Blue");
        assert.notEqual(originalWebsite.id, added);
        assert.equal(Number(originalWebsite.internet_price), 10000);
        assert.equal("cost" in originalWebsite, false);
        assert.equal("recon" in originalWebsite, false);
        assert.equal("cost" in (await queue(added)).last_crm_values, false);
        await save(
          vehicle({ vin: "3FA6P0H72LR100004", stock_number: "CRM104" }),
          added,
        );
        assert.equal((await website(added)).id, originalWebsite.id);
        assert.equal(
          Number(
            (
              await one("select count(*) n from vehicles where vin=$1", [
                originalWebsite.vin,
              ])
            ).n,
          ),
          1,
        );
        const state = (
          await one("select dmcrm_inventory_website_state($1,$2) links", [
            org,
            owner,
          ])
        ).links;
        const link = state.find((q: any) => q.inventory_id === added);
        assert.equal(link.listing_status, "draft");
        assert.equal(link.website_id, originalWebsite.id);
        assert.ok(!JSON.stringify(state).includes('"last_crm_values"'));
      },
    );
    await t.test(
      "Control Room photos, descriptions and online price persist through CRM price/cost and fact edits",
      async () => {
        await pg.query(
          `update vehicles set internet_price=12995,description='Website-only description with features.',photos=array['fixture/one.webp','fixture/two.webp'],features=array['Leather seats'],fuel='Gasoline',status='available' where id=$1`,
          [originalWebsite.id],
        );
        const before = await website(added),
          q = await queue(added);
        await save(
          vehicle({
            vin: "3FA6P0H72LR100004",
            stock_number: "CRM104",
            cost: 8000,
            recon: 900,
          }),
          added,
        );
        assert.equal((await queue(added)).attempts, q.attempts);
        assert.deepEqual((await website(added)).updated_at, before.updated_at);
        await save(
          vehicle({
            vin: "3FA6P0H72LR100004",
            stock_number: "CRM104",
            cost: 8000,
            recon: 900,
            price: 11500,
            mileage: 46000,
            trim: "Titanium",
          }),
          added,
        );
        const w = await website(added);
        assert.equal(w.miles, 46000);
        assert.equal(w.trim, "Titanium");
        assert.equal(Number(w.internet_price), 12995);
        assert.deepEqual(w.photos, before.photos);
        assert.deepEqual(w.features, before.features);
        assert.equal(w.description, before.description);
        assert.equal(w.fuel, "Gasoline");
        assert.equal(w.slug, before.slug);
        // Website fact refinements survive an unrelated price-only CRM change.
        await pg.query("update vehicles set exterior='Deep blue' where id=$1", [
          w.id,
        ]);
        await pg.query("update dmcrm_inventory set price=11900 where id=$1", [
          added,
        ]);
        assert.equal((await website(added)).exterior, "Deep blue");
      },
    );
    await t.test(
      "pending stock follows availability; a real sold deal and unwind protect website visibility",
      async () => {
        await pg.query(
          "update dmcrm_inventory set status='pending' where id=$1",
          [added],
        );
        assert.equal((await website(added)).status, "pending");
        await pg.query("update vehicles set status='available' where id=$1", [
          originalWebsite.id,
        ]);
        assert.equal((await website(added)).status, "pending");
        await pg.query(
          "update dmcrm_inventory set status='in_stock' where id=$1",
          [added],
        );
        assert.equal((await website(added)).status, "available");
        const c = await one(
          "insert into dmcrm_customers(org_id,name) values($1,'Fixture Buyer') returning id",
          [org],
        );
        const op = await one(
          "insert into dmcrm_opportunities(org_id,customer_id,inventory_id,title) values($1,$2,$3,'Fixture purchase') returning id",
          [org, c.id, added],
        );
        await command({
          type: "close_opportunity",
          id: op.id,
          outcome: "sold",
        });
        assert.equal((await website(added)).status, "sold");
        await pg.query("update vehicles set status='available' where id=$1", [
          originalWebsite.id,
        ]);
        assert.equal((await website(added)).status, "sold");
        await command({
          type: "unwind_sale",
          opportunity_id: op.id,
          reason: "Fixture financing canceled",
        });
        const w = await website(added);
        assert.equal(w.status, "draft");
        assert.deepEqual(w.photos, ["fixture/one.webp", "fixture/two.webp"]);
        assert.equal(Number(w.internet_price), 12995);
      },
    );
    await t.test(
      "deleting stock archives its website listing and prevents stale Control Room republishing",
      async () => {
        const deleted = await one("select * from dmcrm_inventory where id=$1", [
          zeroCRM,
        ]);
        await command({
          type: "delete_inventory",
          id: zeroCRM,
          updated_at: new Date(deleted.updated_at).toISOString(),
          reason: "Fixture duplicate record",
        });
        const w = await website(zeroCRM);
        assert.equal(w.status, "archived");
        await pg.query(
          "update vehicles set status='available',internet_price=9900,description='Trying a stale control room save.',photos=array['fixture/one.webp'] where id=$1",
          [w.id],
        );
        assert.equal((await website(zeroCRM)).status, "archived");
      },
    );
    await t.test(
      "stock and VIN conflicts surface for review without overwriting either website vehicle",
      async () => {
        const other = await one(
          `insert into vehicles(slug,vin,stock_number,year,make,model,miles,internet_price) values('other-vehicle','3FA6P0H72LR100006','WEB-TAKEN',2020,'Other','Vehicle',10000,12000) returning *`,
        );
        const id = await save(
          vehicle({ vin: "3FA6P0H72LR100007", stock_number: "web-taken" }),
        );
        assert.equal((await queue(id)).state, "blocked");
        assert.equal((await queue(id)).last_error_code, "stock_conflict");
        assert.equal(await website(id), undefined);
        assert.equal((await feed()).websiteInventory.pending, 1);
        await save(
          vehicle({ vin: "3FA6P0H72LR100007", stock_number: "CRM107" }),
          id,
        );
        const linked = await website(id);
        assert.equal((await queue(id)).state, "synced");
        await save(vehicle({ vin: other.vin, stock_number: "CRM107" }), id);
        assert.equal((await queue(id)).last_error_code, "vin_conflict");
        assert.equal((await website(id)).vin, "3FA6P0H72LR100007");
        assert.equal(
          (
            await one("select stock_number from vehicles where id=$1", [
              other.id,
            ])
          ).stock_number,
          "WEB-TAKEN",
        );
        await save(
          vehicle({ vin: "3FA6P0H72LR100007", stock_number: "CRM107" }),
          id,
        );
        assert.equal((await website(id)).id, linked.id);
        assert.equal((await feed()).websiteInventory.pending, 0);
      },
    );
    await t.test(
      "website limits are actionable; failed writes roll back partial website rows and retry the saved CRM vehicle",
      async () => {
        const tooLong = await save(
          vehicle({ vin: "3FA6P0H72LR100008", stock_number: "X".repeat(41) }),
        );
        assert.equal((await queue(tooLong)).last_error_code, "website_limits");
        await save(
          vehicle({ vin: "3FA6P0H72LR100008", stock_number: "CRM108" }),
          tooLong,
        );
        assert.equal((await queue(tooLong)).state, "synced");
        await pg.exec(`create function reject_fixture_website() returns trigger language plpgsql as $$begin if new.stock_number='FAIL109' then raise exception 'Injected website failure';end if;return new;end$$;
    create trigger reject_fixture_website after insert or update on vehicles for each row execute function reject_fixture_website();`);
        const failure = await save(
          vehicle({ vin: "3FA6P0H72LR100009", stock_number: "FAIL109" }),
        );
        assert.equal((await queue(failure)).state, "pending");
        assert.equal((await queue(failure)).attempts, 1);
        assert.equal(await website(failure), undefined);
        assert.ok(
          await one("select id from dmcrm_inventory where id=$1", [failure]),
        );
        assert.equal(
          await one("select id from vehicles where vin='3FA6P0H72LR100009'"),
          undefined,
        );
        await pg.exec(
          "drop trigger reject_fixture_website on vehicles;drop function reject_fixture_website();update dmcrm_inventory_website set next_attempt_at=now() where state='pending';",
        );
        assert.equal((await feed()).websiteInventory.pending, 0);
        assert.equal((await queue(failure)).attempts, 2);
        assert.equal((await website(failure)).status, "draft");
      },
    );
    await t.test(
      "retail trade intake creates one draft; wholesale and unwind remove it from sale",
      async () => {
        const saleStock = await save(
          vehicle({ vin: "3FA6P0H72LR100011", stock_number: "CRM111" }),
        );
        const c = await one(
          "insert into dmcrm_customers(org_id,name) values($1,'Fixture Trade Buyer') returning id",
          [org],
        );
        const trade = {
          vin: "3FA6P0H72LR100012",
          year: 2015,
          make: "Toyota",
          model: "Corolla",
          trim: "",
          description: "2015 Toyota Corolla",
          mileage: 120000,
          allowance: 4000,
          acv: 3000,
          payoff: 0,
        };
        const op = await one(
          "insert into dmcrm_opportunities(org_id,customer_id,inventory_id,title,trade,trade_vehicle) values($1,$2,$3,'Fixture trade purchase',$4::jsonb,'2015 Toyota Corolla') returning id",
          [org, c.id, saleStock, JSON.stringify(trade)],
        );
        await command({
          type: "close_opportunity",
          id: op.id,
          outcome: "sold",
        });
        let intake = await one(
          "select * from dmcrm_trades where opportunity_id=$1",
          [op.id],
        );
        assert.equal(intake.stock_number, "CRM111A");
        assert.equal(intake.inventory_id, null);
        assert.equal(
          await one("select id from vehicles where vin=$1", [trade.vin]),
          undefined,
        );
        const retail = {
          ...intake,
          status: "retail",
          year: 2015,
          make: "Toyota",
          model: "Corolla",
          trim: "",
          color: "Silver",
          mileage: 120500,
          cost: 3000,
          recon: 400,
          price: 5995,
          wholesale_price: null,
          wholesale_on: "",
          notes: "Fixture intake",
        };
        await command({
          type: "update_trade_intake",
          id: intake.id,
          revision: intake.revision,
          trade: retail,
        });
        intake = await one("select * from dmcrm_trades where id=$1", [
          intake.id,
        ]);
        const w = await website(intake.inventory_id);
        assert.equal(w.status, "draft");
        assert.equal(w.stock_number, "CRM111A");
        assert.equal(Number(w.internet_price), 5995);
        await command({
          type: "update_trade_intake",
          id: intake.id,
          revision: intake.revision,
          trade: { ...retail, status: "wholesale" },
        });
        assert.equal((await website(intake.inventory_id)).status, "archived");
        intake = await one("select * from dmcrm_trades where id=$1", [
          intake.id,
        ]);
        await command({
          type: "update_trade_intake",
          id: intake.id,
          revision: intake.revision,
          trade: retail,
        });
        assert.equal((await website(intake.inventory_id)).id, w.id);
        assert.equal((await website(intake.inventory_id)).status, "draft");
        await command({
          type: "unwind_sale",
          opportunity_id: op.id,
          reason: "Fixture trade returned to customer",
        });
        assert.equal((await website(intake.inventory_id)).status, "archived");
      },
    );
    await t.test(
      "a missed trigger is recovered from current CRM facts on refresh",
      async () => {
        await pg.exec(
          "alter table dmcrm_inventory disable trigger dmcrm_inventory_website",
        );
        const missed = await save(
          vehicle({ vin: "3FA6P0H72LR100013", stock_number: "CRM113" }),
        );
        await pg.exec(
          "alter table dmcrm_inventory enable trigger dmcrm_inventory_website",
        );
        assert.equal(await queue(missed), undefined);
        await feed();
        assert.equal((await website(missed)).miles, 45000);
        await pg.exec(
          "alter table dmcrm_inventory disable trigger dmcrm_inventory_website",
        );
        await pg.query("update dmcrm_inventory set mileage=45555 where id=$1", [
          missed,
        ]);
        await pg.exec(
          "alter table dmcrm_inventory enable trigger dmcrm_inventory_website",
        );
        await feed();
        assert.equal((await website(missed)).miles, 45555);
      },
    );
    await t.test(
      "production verification rolls back every fixture and website inquiries still link to the correct CRM VIN",
      async () => {
        const before = await one(
          "select (select count(*) from vehicles) website,(select count(*) from dmcrm_inventory) inventory,(select count(*) from dmcrm_inventory_website) links,(select count(*) from leads) leads",
        );
        await pg.exec("begin");
        await verifyInventoryWebsite(pg);
        await verifyWebsiteIntake(pg);
        await pg.exec("commit");
        assert.deepEqual(
          await one(
            "select (select count(*) from vehicles) website,(select count(*) from dmcrm_inventory) inventory,(select count(*) from dmcrm_inventory_website) links,(select count(*) from leads) leads",
          ),
          before,
        );
        const w = await website(existingCRM),
          request = crypto.randomUUID();
        await pg.query("select submit_lead($1::jsonb)", [
          JSON.stringify({
            requestId: request,
            kind: "vehicle",
            name: "Website Buyer",
            email: "buyer@example.invalid",
            phone: "2025550111",
            preferredContact: "Email",
            message: "Test drive this CRM-origin listing.",
            vehicleId: w.id,
            originalVehicleVin: w.vin,
            purpose: "test-drive",
          }),
        ]);
        const op = await one(
          "select o.inventory_id from dmcrm_website_intake q join dmcrm_opportunities o on o.id=q.opportunity_id where q.id=$1",
          [request],
        );
        assert.equal(op.inventory_id, existingCRM);
      },
    );
    await t.test(
      "other dealerships and unauthenticated clients cannot publish or read the bridge",
      async () => {
        await pg.exec(`insert into dmcrm_orgs(id,name,slug) values('${otherOrg}','Other dealership','other');
    insert into dmcrm_members(org_id,user_id,name,role) values('${otherOrg}','${owner}','Test Owner','owner');
    insert into dmcrm_staff(org_id,user_id,name,email,role) values('${otherOrg}','${owner}','Test Owner','owner@example.invalid','owner');`);
        const id = await command(
          {
            type: "save_inventory",
            vehicle: vehicle({
              vin: "3FA6P0H72LR100010",
              stock_number: "OTHER110",
            }),
          },
          otherOrg,
        );
        assert.equal(await queue(id), undefined);
        assert.equal(
          await one("select id from vehicles where vin='3FA6P0H72LR100010'"),
          undefined,
        );
        assert.deepEqual(
          (
            await one("select dmcrm_inventory_website_state($1,$2) links", [
              otherOrg,
              owner,
            ])
          ).links,
          [],
        );
        await assert.rejects(
          pg.query("select dmcrm_inventory_website_state($1,$2)", [
            org,
            crypto.randomUUID(),
          ]),
          /membership required/,
        );
        await pg.exec("set role anon");
        await assert.rejects(
          pg.query("select * from dmcrm_inventory_website"),
          /permission denied/,
        );
        await assert.rejects(
          pg.query("select dmcrm_sync_inventory_vehicle($1)", [existingCRM]),
          /permission denied/,
        );
        await assert.rejects(
          pg.query("select dmcrm_inventory_website_state($1,$2)", [org, owner]),
          /permission denied/,
        );
        await pg.exec("reset role;set role service_role");
        await assert.rejects(
          pg.query("select dmcrm_retry_inventory_website($1)", [org]),
          /permission denied/,
        );
        await pg.exec("reset role");
      },
    );
  } finally {
    await pg.close();
  }
});

test("inventory listing status explains drafts and failures and links directly to Control Room", () => {
  const ws = demoWorkspace(),
    i = ws.inventory[0];
  const link: WebsiteInventoryLink = {
    inventory_id: i.id,
    website_id: "00000000-0000-4000-8000-000000000099",
    state: "synced",
    error_code: null,
    synced_at: null,
    listing_status: "draft",
    website_price: 10000,
  };
  assert.ok(inventorySchema.safeParse(vehicle()).success);
  assert.equal(websiteInventoryLabel(link), "Website draft");
  assert.match(
    websiteInventoryIssue({
      ...link,
      state: "blocked",
      error_code: "stock_conflict",
    }),
    /Correct the CRM stock number/,
  );
  const html = renderToStaticMarkup(
    createElement(InventoryView, {
      inventory: [i],
      websiteInventory: [link],
      websiteConnected: true,
      onEdit() {},
      onAdd() {},
      onRefresh() {},
    }),
  );
  assert.match(html, /Website draft/);
  assert.ok(
    html.includes(
      websiteListingEditorUrl(link.website_id!).replaceAll("&", "&amp;"),
    ),
  );
  assert.match(html, /Refresh website status/);
  assert.match(html, /Later website pricing stays separate/);
});
