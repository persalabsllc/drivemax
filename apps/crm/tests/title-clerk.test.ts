import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import {
  calendarDays,
  checklistProgress,
  dmvForms,
  shiftDate,
  tagTiming,
  titleAge,
  titleChecks,
  titleValues,
  titleValidation,
  type TempTag,
  type TitleCase,
} from "../lib/title-clerk";
import { demoWorkspace } from "../lib/demo";
import { demoCommand, commandSchema, dayKey } from "../lib/model";
import { seedOperations } from "../lib/operations-demo";
import { seedTitleClerk } from "../lib/title-clerk-demo";
import { soldPackForms, documentContext } from "../lib/documents";
import { buildSoldPack } from "../lib/pdf-output";
import { verifyTitleClerk } from "../scripts/verify-title-clerk.mjs";
import { readWorkspaceRecords } from "../lib/workspace-records";

test("workspace responses limit title files, tags, documents and history to the salesperson's current deals", async () => {
  const tables: Record<string, unknown[]> = {
    opportunities: [
      { id: "own-op", assigned_to: "staff-a" },
      { id: "other-op", assigned_to: "staff-b" },
    ],
    title_cases: [
      { id: "own-case", opportunity_id: "own-op" },
      { id: "other-case", opportunity_id: "other-op" },
    ],
    temp_tags: [
      { id: "own-tag", case_id: "own-case" },
      { id: "other-tag", case_id: "other-case" },
    ],
    title_documents: [
      { id: "own-doc", case_id: "own-case" },
      { id: "other-doc", case_id: "other-case" },
    ],
    title_events: [
      { id: "own-event", case_id: "own-case" },
      { id: "other-event", case_id: "other-case" },
    ],
    deal_files: [
      { id: "own-file", opportunity_id: "own-op" },
      { id: "other-file", opportunity_id: "other-op" },
    ],
  };
  const client = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        order() {
          return query;
        },
        async range() {
          return {
            data: tables[table.replace("dmcrm_", "")] ?? [],
            error: null,
          };
        },
      };
      return query;
    },
  };
  const own = await readWorkspaceRecords(client as any, {
    org_id: "org",
    staff_id: "staff-a",
    role: "sales",
  });
  for (const key of [
    "title_cases",
    "temp_tags",
    "title_documents",
    "title_events",
    "deal_files",
  ] as const) {
    assert.equal(own[key]?.length, 1);
    assert(own[key]?.[0].id.startsWith("own-"));
  }
  const manager = await readWorkspaceRecords(client as any, {
    org_id: "org",
    staff_id: "staff-a",
    role: "manager",
  });
  for (const key of [
    "title_cases",
    "temp_tags",
    "title_documents",
    "title_events",
    "deal_files",
  ] as const)
    assert.equal(manager[key]?.length, 2);
});

test("title aging and tag dates use calendar days across DST, leap days and expiration boundaries", () => {
  assert.equal(shiftDate("2026-10-01", 60), "2026-11-30");
  assert.equal(calendarDays("2026-03-01", "2026-04-30"), 60);
  assert.equal(shiftDate("2028-01-01", 60), "2028-03-01");
  assert.equal(dayKey(new Date("2026-10-27T02:00:00Z")), "2026-10-26");
  const tag = { status: "active", expires_on: "2026-11-30" } as TempTag;
  assert(tagTiming(tag, "2026-11-23").expiring);
  assert(tagTiming(tag, "2026-11-30").expiring);
  assert(!tagTiming(tag, "2026-11-30").expired);
  assert(tagTiming(tag, "2026-12-01").expired);
  assert(!tagTiming({ ...tag, status: "void" }, "2026-12-01").expired);
  assert.equal(
    titleAge(
      { sold_on: "2026-10-01", completed_on: "2026-10-12" } as TitleCase,
      "2026-11-01",
    ),
    11,
  );
  assert.equal(
    titleAge(
      { sold_on: "2026-10-01", completed_on: null } as TitleCase,
      "2026-11-01",
    ),
    31,
  );
});

test("demo title files follow individual sales and enforce completion and pending reasons", () => {
  let ws = seedTitleClerk(seedOperations(demoWorkspace()));
  assert(ws.title_cases!.length > 0);
  const c = ws.title_cases![0],
    v = titleValues(c),
    today = dayKey();
  assert.equal(
    titleValidation(c, { ...v, status: "pending" }, today),
    "Enter a pending reason",
  );
  assert.equal(
    titleValidation(
      c,
      { ...v, status: "complete", completed_on: today },
      today,
    ),
    "Resolve every checklist item before completing paperwork",
  );
  const checklist = Object.fromEntries(
    Object.keys(titleChecks).map((k) => [k, "not_needed"]),
  ) as typeof v.checklist;
  assert.equal(checklistProgress({ checklist }).done, 12);
  ws = demoCommand(ws, {
    type: "save_title_case",
    id: c.id,
    revision: c.revision,
    values: { ...v, checklist, status: "complete", completed_on: today },
  });
  assert.equal(ws.title_cases![0].status, "complete");
  assert.throws(
    () =>
      demoCommand(ws, {
        type: "save_title_case",
        id: c.id,
        revision: c.revision,
        values: v,
      }),
    /Record changed/,
  );
  const invalid = {
    type: "save_temp_tag",
    id: randomUUID(),
    case_id: c.id,
    revision: 0,
    values: {
      number: "bad tag!",
      issued_on: today,
      expires_on: shiftDate(today, 60),
      status: "active",
      closed_on: null,
      notes: "",
    },
  };
  assert(!commandSchema.safeParse(invalid).success);
  assert(
    !commandSchema.safeParse({
      type: "save_title_case",
      id: c.id,
      revision: 1,
      values: { ...v, checklist: { unknown: "done" } },
    }).success,
  );
});

test("the five requested DMV forms print independently and together from the saved sold snapshot", async () => {
  const ws = seedTitleClerk(seedOperations(demoWorkspace())),
    c = ws.title_cases![0],
    o = ws.opportunities.find((o) => o.id === c.opportunity_id)!,
    customer = ws.customers.find((x) => x.id === c.customer_id)!;
  const context = documentContext(ws, customer, o),
    before = JSON.stringify(context);
  customer.name = "Changed after sale";
  assert.equal(JSON.stringify(documentContext(ws, customer, o)), before);
  const all = soldPackForms("without-trade"),
    forms = all.filter((f) => dmvForms.some((d) => d.id === f.id));
  assert.equal(forms.length, 5);
  const template = (f: (typeof forms)[number]) =>
    fs.readFile(new URL("../assets/forms/" + f.file, import.meta.url));
  for (const f of forms) {
    const bytes = await buildSoldPack(context, o.paperwork, template, [f]);
    assert.equal(
      (await PDFDocument.load(bytes)).getPageCount(),
      f.pages.length,
    );
  }
  const bytes = await buildSoldPack(context, o.paperwork, template, forms);
  assert.equal(
    (await PDFDocument.load(bytes)).getPageCount(),
    forms.reduce((n, f) => n + f.pages.length, 0),
  );
});

test("title clerk database lifecycle isolates sales, permissions, documents and tag history", async (t) => {
  const pg = new PGlite(),
    org = "d5a1c100-0000-4000-8000-000000000001",
    owner = randomUUID(),
    sales = randomUUID(),
    other = randomUUID(),
    cid = randomUUID(),
    oid = randomUUID();
  const one = async (sql: string, args: unknown[] = []) =>
    (await pg.query<any>(sql, args)).rows[0];
  const cmd = async (value: unknown, actor = owner, organization = org) =>
    one("select dmcrm_command($1,$2,$3::jsonb) id", [
      organization,
      actor,
      JSON.stringify(value),
    ]);
  const row = (table: string, id: string) =>
    one(`select * from dmcrm_${table} where id=$1`, [id]);
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
    await pg.exec(
      `insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${other}','other@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Owner','owner');`,
    );
    for (const file of (await fs.readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith("022_"))
      .sort())
      await pg.exec(
        await fs.readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await pg.exec(
      `insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales','sales'),('${org}','${other}','Other','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales','sales@example.invalid','sales'),('${org}','${other}','Other','other@example.invalid','sales');`,
    );
    const staff = (
      await one("select id from dmcrm_staff where user_id=$1", [sales])
    ).id;
    await pg.query(
      "insert into dmcrm_customers(id,org_id,name) values($1,$2,'Original buyer')",
      [cid, org],
    );
    await pg.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,assigned_to,vehicle_interest,vehicle_details) values($1,$2,$3,$4,'2017 Toyota Highlander',$5::jsonb)",
      [
        oid,
        org,
        cid,
        staff,
        JSON.stringify({
          vin: "5TDZZRFH0HS205555",
          stock_number: "TITLE-001",
          year: 2017,
          make: "Toyota",
          model: "Highlander",
        }),
      ],
    );
    await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
    await pg.exec(
      await fs.readFile(
        new URL("../db/022_title_clerk.sql", import.meta.url),
        "utf8",
      ),
    );
    let c = await one(
      "select * from dmcrm_title_cases where opportunity_id=$1",
      [oid],
    );
    const today = (
      await one(
        "select (now() at time zone 'America/New_York')::date::text today",
      )
    ).today;
    const base = {
      status: "sold",
      checklist: {},
      notes: "",
      pending_reason: "",
      next_action_on: null,
      ready_on: null,
      submitted_on: null,
      completed_on: null,
    };
    const save = (values: unknown, revision = c.revision, actor = owner) =>
      cmd({ type: "save_title_case", id: c.id, revision, values }, actor);
    const tagId = randomUUID(),
      tag = {
        number: "NC-12345",
        issued_on: today,
        expires_on: shiftDate(today, 60),
        status: "active",
        closed_on: null,
        notes: "",
      };
    const saveTag = (values: unknown, id = tagId, revision = 0) =>
      cmd({ type: "save_temp_tag", id, case_id: c.id, revision, values });
    await t.test(
      "backfills existing sold deals with stable buyer and vehicle details",
      async () => {
        assert.equal(c.customer_name, "Original buyer");
        assert.equal(c.vin, "5TDZZRFH0HS205555");
        assert.equal(c.stock_number, "TITLE-001");
        await pg.query(
          "update dmcrm_customers set name='Changed buyer' where id=$1",
          [cid],
        );
        assert.equal(
          (await row("title_cases", c.id)).customer_name,
          "Original buyer",
        );
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_title_events where case_id=$1",
                [c.id],
              )
            ).n,
          ),
          1,
        );
      },
    );
    await t.test(
      "permissions, revision checks and status validation cannot be bypassed at the RPC",
      async () => {
        await assert.rejects(save(base, 0, other), /Assigned salesperson/);
        await assert.rejects(
          cmd(
            { type: "save_title_case", id: c.id, revision: 0, values: base },
            owner,
            randomUUID(),
          ),
          /membership/,
        );
        await assert.rejects(
          save({ ...base, status: "pending" }),
          /pending reason/,
        );
        await assert.rejects(
          save({ ...base, status: "complete", completed_on: today }),
          /checklist/,
        );
        await assert.rejects(
          save({ ...base, checklist: { surprise: "done" } }),
          /Invalid title/,
        );
        await assert.rejects(
          save({
            ...base,
            status: "at_dmv",
            submitted_on: shiftDate(today, 1),
          }),
          /milestone/,
        );
        await save(
          {
            ...base,
            status: "pending",
            pending_reason: "Waiting for title",
            next_action_on: today,
          },
          0,
          sales,
        );
        await assert.rejects(save(base, 0), /Record changed/);
        c = await row("title_cases", c.id);
        assert.equal(c.revision, 1);
        const allDone = Object.fromEntries(
          Object.keys(titleChecks).map((k) => [k, "done"]),
        );
        await save({
          ...base,
          checklist: allDone,
          status: "complete",
          ready_on: today,
          submitted_on: today,
          completed_on: today,
        });
        c = await row("title_cases", c.id);
        assert.equal(c.status, "complete");
        await save(base);
        c = await row("title_cases", c.id);
        assert.equal(c.completed_on, null);
      },
    );
    await t.test(
      "temporary tags enforce printed dates, unique numbers and one active tag without erasing history",
      async () => {
        await assert.rejects(
          saveTag({ ...tag, expires_on: shiftDate(today, 61) }),
          /60 days/,
        );
        await assert.rejects(saveTag({ ...tag, closed_on: today }), /60 days/);
        await saveTag(tag);
        await assert.rejects(
          saveTag({ ...tag, number: "NC12345" }, randomUUID()),
          /already recorded/,
        );
        await assert.rejects(
          saveTag({ ...tag, number: "NC-12346" }, randomUUID()),
          /current tag/,
        );
        await assert.rejects(
          saveTag({ ...tag, status: "void", closed_on: today }),
          /reason/,
        );
        await saveTag({ ...tag, status: "permanent", closed_on: today });
        await assert.rejects(saveTag(tag, tagId, 1), /reactivated/);
        await assert.rejects(
          saveTag({ ...tag, status: "permanent", closed_on: today }, tagId, 0),
          /Record changed/,
        );
        await saveTag({ ...tag, number: "NC-12346" }, randomUUID());
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_temp_tags where case_id=$1",
                [c.id],
              )
            ).n,
          ),
          2,
        );
      },
    );
    let file: string;
    await t.test(
      "document attachment rejects other deals, retries safely and keeps archived metadata immutable",
      async () => {
        file = randomUUID();
        await pg.query(
          "insert into dmcrm_deal_files(id,org_id,customer_id,opportunity_id,name,kind,size,mime,path,created_by,sha256) values($1,$2,$3,$4,'DMV receipt.pdf','title',100,'application/pdf',$5,$6,$7)",
          [file, org, cid, oid, `${org}/${file}.pdf`, owner, "a".repeat(64)],
        );
        const attach = {
          type: "attach_title_document",
          id: c.id,
          file_id: file,
          purpose: "dmv_receipt",
        };
        await assert.rejects(cmd(attach, other), /Assigned salesperson/);
        await cmd(attach, sales);
        await cmd(attach, sales);
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_title_documents where case_id=$1",
                [c.id],
              )
            ).n,
          ),
          1,
        );
        await assert.rejects(
          cmd({ ...attach, file_id: randomUUID() }),
          /does not belong/,
        );
        await assert.rejects(
          pg.query("update dmcrm_deal_files set name='Changed' where id=$1", [
            file,
          ]),
          /immutable|original|retained|cannot/i,
        );
      },
    );
    await t.test(
      "unwinding voids the tag; reselling opens a separate title file and preserves the old file",
      async () => {
        const oldCase = c.id;
        await cmd({
          type: "unwind_sale",
          opportunity_id: oid,
          reason: "Buyer canceled",
        });
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_temp_tags where case_id=$1 and status='active'",
                [oldCase],
              )
            ).n,
          ),
          0,
        );
        await assert.rejects(save(base), /Unwound/);
        await cmd({ type: "close_opportunity", id: oid, outcome: "sold" });
        const next = await one(
          "select c.* from dmcrm_title_cases c join dmcrm_sales s on s.id=c.sale_id where c.opportunity_id=$1 and s.status='sold'",
          [oid],
        );
        assert.notEqual(next.id, oldCase);
        assert.equal(next.status, "sold");
        assert.deepEqual(next.checklist, {});
        await assert.rejects(
          cmd({
            type: "attach_title_document",
            id: next.id,
            file_id: file,
            purpose: "dmv_receipt",
          }),
          /another title case/,
        );
        await assert.rejects(
          cmd({
            type: "save_temp_tag",
            id: tagId,
            case_id: next.id,
            revision: 1,
            values: tag,
          }),
          /unavailable/,
        );
        assert.equal(
          Number(
            (
              await one(
                "select count(*) n from dmcrm_title_documents where case_id=$1",
                [oldCase],
              )
            ).n,
          ),
          1,
        );
        assert(
          (
            await one(
              "select count(*)::int n from dmcrm_title_events where case_id=$1",
              [oldCase],
            )
          ).n >= 8,
        );
      },
    );
    await t.test(
      "anonymous clients cannot read the new tables or call private helper functions",
      async () => {
        await pg.exec("set role anon");
        try {
          await assert.rejects(
            pg.query("select * from dmcrm_title_cases"),
            /permission/,
          );
          await assert.rejects(
            pg.query("select dmcrm_open_title_case($1)", [c.sale_id]),
            /permission/,
          );
        } finally {
          await pg.exec("reset role");
        }
      },
    );
    await t.test(
      "production release verification rolls all fixtures back",
      async () => {
        const before = await one(
          "select (select count(*) from dmcrm_sales)::int sales,(select count(*) from dmcrm_title_cases)::int cases,(select count(*) from dmcrm_deal_files)::int files",
        );
        await pg.exec("begin");
        await verifyTitleClerk(pg);
        await pg.exec("commit");
        assert.deepEqual(
          await one(
            "select (select count(*) from dmcrm_sales)::int sales,(select count(*) from dmcrm_title_cases)::int cases,(select count(*) from dmcrm_deal_files)::int files",
          ),
          before,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
