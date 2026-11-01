import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verifyLenderFinance } from "../scripts/verify-lender-finance.mjs";
import { defaultQuote } from "../lib/model";
import { lenderAccounting, emptyLenderFinance } from "../lib/finance";
test("lender SQL: saved quote, sold ledger, fees, reserve, commissions and audited corrections", async () => {
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
      "insert into auth.users(id,email) values($1,'lender-owner@example.invalid')",
      [owner],
    );
    await db.query(
      "insert into staff(id,email,name,role) values($1,'lender-owner@example.invalid','Fictional Owner','owner')",
      [owner],
    );
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await db.exec("begin");
    await verifyLenderFinance(db);
    for (const days of [30, 45, 90])
      for (const months of [6, 36, 60, 84])
        for (const buyRate of [0, 14, 17.999]) {
          const values = {
            ...defaultQuote,
            price: 20495.49,
            docFee: 399,
            titleFee: 114,
            taxMode: "auto" as const,
            tradeAllowance: 1500,
            payoff: 357.12,
            downPayment: 2199.99,
            months,
            apr: 18.999,
            daysToFirstPayment: days,
            lenderFinance: {
              ...emptyLenderFinance,
              buyRate,
              lenderFees: 259.99,
              payoutPercent: 72.5,
            },
          };
          const result = await db.query<{ a: unknown }>(
            "select dmcrm_lender_accounting($1::jsonb) a",
            [JSON.stringify(values)],
          );
          assert.deepEqual(
            result.rows[0].a,
            lenderAccounting(values),
            `SQL/browser parity: ${months} months, ${buyRate}% buy, ${days} days`,
          );
        }
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});
