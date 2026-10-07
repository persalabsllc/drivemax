import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  appraisalNumbers,
  appraisalSchema,
  compSchema,
  newAppraisal,
  subjectSchema,
  type Appraisal,
  type AppraisalComp,
} from "../lib/appraisal";
import {
  marketSearchParams,
  marketDrivetrain,
  parseMarketListings,
  parsePrediction,
} from "../lib/appraisal-provider";
import { decryptMarketKey, encryptMarketKey } from "../lib/appraisal-crypto";

const staffId = "7c43d6cd-481d-4a1b-9989-465ac7a6317a";
const recordId = "0e400b44-3e80-4d19-a9f4-4e283be977d6";
const date = new Date().toISOString().slice(0, 10);
function fixture(): Appraisal {
  const data = newAppraisal();
  data.subject = {
    ...data.subject,
    vin: "1HGCM82633A004352",
    year: 2003,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    miles: 100000,
  };
  return data;
}
function comp(
  price: number,
  kind: AppraisalComp["kind"] = "asking",
  patch: Partial<AppraisalComp> = {},
): AppraisalComp {
  return compSchema.parse({
    id: `${kind}-${price}`,
    title: "2003 Honda Accord EX",
    price,
    miles: 100000,
    kind,
    source:
      kind === "sold" ? "Test transaction invoice" : "Test dealer listing",
    date,
    origin: "manual",
    ...patch,
  });
}
test("buy limit subtracts allowance, recon, fees, transport, and profit; never adds the public fee", () => {
  const data = fixture();
  data.manualComps = [comp(12000), comp(15000), comp(18000)];
  data.costs.transport = 125;
  data.costs.acquisition = 11200;
  const n = appraisalNumbers(data);
  assert.equal(n.retail, 15000);
  assert.equal(n.expectedSale, 14500);
  assert.equal(n.maxBuy, 10850);
  assert.equal(n.allIn, 12325);
  assert.equal(n.gross, 2175);
  assert.equal(n.rank, 2);
  assert.equal(n.rankTotal, 4);
});
test("pricing strategies follow included comp quartiles and exclusions persist", () => {
  const data = fixture();
  data.manualComps = [comp(12000), comp(15000), comp(18000)];
  data.strategy = "quick";
  assert.equal(appraisalNumbers(data).retail, 13500);
  data.strategy = "margin";
  assert.equal(appraisalNumbers(data).retail, 16500);
  data.strategy = "balanced";
  data.excludedCompIds = ["asking-18000"];
  assert.equal(appraisalNumbers(data).medianAsk, 13500);
  assert.deepEqual(
    appraisalSchema.parse(JSON.parse(JSON.stringify(data))).excludedCompIds,
    ["asking-18000"],
  );
});
test("listing prices and sale transaction prices are separate evidence", () => {
  const data = fixture();
  data.manualComps = [
    comp(12000),
    comp(15000),
    comp(18000),
    comp(9000, "sold"),
    comp(10000, "sold"),
  ];
  const n = appraisalNumbers(data);
  assert.equal(n.medianAsk, 15000);
  assert.equal(n.medianSold, 9500);
  assert.equal(n.retail, 15000);
  data.manualComps = data.manualComps.filter((c) => c.kind === "asking");
  assert.equal(appraisalNumbers(data).medianSold, null);
});
test("missing data stays missing; there are no fabricated valuations", () => {
  const n = appraisalNumbers(fixture());
  for (const value of [
    n.predictedPrice,
    n.retail,
    n.medianAsk,
    n.medianSold,
    n.maxBuy,
    n.gross,
  ])
    assert.equal(value, null);
  assert.equal(
    parsePrediction({
      generic_prices: [{ marketcheck_price: 9999 }],
      marketcheck_price: null,
    }),
    null,
  );
});
test("VIN, mileage, or filter changes stop old market snapshots affecting the buy limit", () => {
  const data = fixture();
  data.market = {
    fetchedAt: new Date().toISOString(),
    query: { ...data.subject },
    predictedPrice: 20000,
    totalFound: 3,
    listings: [comp(19000), comp(20000), comp(21000)],
    warnings: [],
  };
  assert.equal(appraisalNumbers(data).retail, 20000);
  for (const patch of [
    { vin: "2T3DWRFV3LW077677" },
    { miles: 101000 },
    { zip: "28560" },
    { trim: "LX" },
    { radius: 250 },
    { exactTrim: false },
  ]) {
    const n = appraisalNumbers({
      ...data,
      subject: { ...data.subject, ...patch },
    });
    assert.equal(n.marketCurrent, false);
    assert.equal(n.retail, null);
    assert.equal(n.maxBuy, null);
  }
});
test("mileage normalization has the right direction and leaves missing odometers unchanged", () => {
  const data = fixture();
  data.costs.mileageAdjustment = 50;
  data.manualComps = [
    comp(10000, "asking", { miles: 120000 }),
    comp(10000, "asking", { id: "low", miles: 80000 }),
    comp(10000, "asking", { id: "unknown", miles: null }),
  ];
  assert.equal(appraisalNumbers(data).medianAsk, 10000);
  data.manualComps = [data.manualComps[0]];
  assert.equal(appraisalNumbers(data).medianAsk, 11000);
  data.manualComps = [comp(10000, "asking", { miles: 80000 })];
  assert.equal(appraisalNumbers(data).medianAsk, 9000);
});
test("your own VIN and duplicate syndicated listings do not inflate the comparable sample", () => {
  const data = fixture();
  data.manualComps = [
    comp(12000, "asking", { vin: "2T3DWRFV3LW077677" }),
    comp(15000, "asking", { vin: "2T3DWRFV3LW077677" }),
    comp(20000, "asking", { vin: data.subject.vin }),
  ];
  assert.equal(appraisalNumbers(data).askingCount, 1);
  assert.equal(appraisalNumbers(data).medianAsk, 12000);
});
test("overrides and condition adjustments are explicit, and impossible deals are flagged numerically", () => {
  const data = fixture();
  data.retailOverride = 10000;
  data.costs.retailAdjustment = -1000;
  data.costs.profit = 15000;
  const n = appraisalNumbers(data);
  assert.equal(n.retail, 9000);
  assert.equal(n.expectedSale, 8500);
  assert.equal(n.rawMaxBuy, -7500);
  assert.equal(n.maxBuy, 0);
});
test("book references require attribution; invalid dates, VINs, and empty mileage are rejected", () => {
  const data = fixture();
  data.book.retail = 12000;
  assert.equal(appraisalSchema.safeParse(data).success, false);
  data.book.source = "J.D. Power";
  data.book.asOf = date;
  assert.equal(appraisalSchema.safeParse(data).success, true);
  assert.equal(
    appraisalSchema.safeParse({
      ...data,
      book: { ...data.book, asOf: "2026-02-31" },
    }).success,
    false,
  );
  assert.equal(
    subjectSchema.safeParse({ ...data.subject, miles: null }).success,
    false,
  );
  assert.equal(
    subjectSchema.safeParse({ ...data.subject, miles: "" }).success,
    false,
  );
  assert.equal(
    subjectSchema.safeParse({ ...data.subject, vin: "1IQCM82633A004352" })
      .success,
    false,
  );
  assert.equal(
    compSchema.safeParse({ ...comp(1000), url: "javascript:alert(1)" }).success,
    false,
  );
});
test("MarketCheck request filters use local inventory search, not VIN history or inferred transactions", () => {
  const params = marketSearchParams(fixture().subject);
  assert.equal(params.get("car_type"), "used");
  assert.equal(params.get("year"), "2003");
  assert.equal(params.get("trim"), "EX");
  assert.equal(params.get("miles_range"), "70000-130000");
  assert.equal(params.get("radius"), "100");
  assert.equal(params.get("rows"), "50");
  assert.equal(params.get("vin"), null);
});
test("provider parser filters mismatches, bad prices, duplicates, source vehicle, and unsafe URLs", () => {
  const subject = fixture().subject;
  const row = {
    id: "listing",
    vin: "2T3DWRFV3LW077677",
    price: 10000,
    miles: 105000,
    build: { year: 2003, make: "Honda", model: "Accord", trim: "EX" },
    dist: 20,
    dom_active: 14,
    vdp_url: "https://example.com/car",
    dealer: { name: "Test Dealer", city: "New Bern", state: "NC" },
  };
  const n = parseMarketListings(
    {
      num_found: 12,
      listings: [
        row,
        row,
        { ...row, vin: subject.vin },
        { ...row, vin: "AAAAAAAAAAAAAAAA1", price: null },
        {
          ...row,
          vin: "AAAAAAAAAAAAAAAA2",
          build: { ...row.build, trim: "LX" },
        },
        { ...row, vin: "AAAAAAAAAAAAAAAA3", miles: 200000 },
        { ...row, vin: "AAAAAAAAAAAAAAAA4", dist: 300 },
        { ...row, vin: "AAAAAAAAAAAAAAAA5", vdp_url: "javascript:bad()" },
      ],
    },
    subject,
    new Date().toISOString(),
  );
  assert.equal(n.totalFound, 12);
  assert.equal(n.listings.length, 1);
  assert.equal(n.listings[0].kind, "asking");
  assert.equal(n.listings[0].daysOnMarket, 14);
  assert.equal(n.listings[0].dealer, "Test Dealer · New Bern · NC");
});
test("drivetrain filters separate front/rear driven wheels and flag AWD/4WD as the provider group", () => {
  const subject = {
    ...fixture().subject,
    drivetrain: "Front-Wheel Drive (FWD)",
  };
  assert.equal(marketSearchParams(subject).get("drivetrain"), "FWD");
  assert.equal(marketDrivetrain("AWD"), "4WD");
  assert.equal(marketDrivetrain("4x2"), null);
  const row = {
    vin: "2T3DWRFV3LW077677",
    price: 14000,
    miles: 100000,
    build: {
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: "EX",
      drivetrain: "RWD",
    },
  };
  assert.equal(
    parseMarketListings({ listings: [row] }, subject, new Date().toISOString())
      .listings.length,
    0,
  );
  assert.equal(
    parseMarketListings(
      { listings: [{ ...row, build: { ...row.build, drivetrain: "FWD" } }] },
      subject,
      new Date().toISOString(),
    ).listings.length,
    1,
  );
});
test("provider API key encryption authenticates ciphertext and uses fresh nonces", () => {
  const secret = "test-only-encryption-secret-32-bytes",
    key = "fake-marketcheck-key";
  const a = encryptMarketKey(key, secret),
    b = encryptMarketKey(key, secret);
  assert.notEqual(a, b);
  assert.equal(a.includes(key), false);
  assert.equal(decryptMarketKey(a, secret), key);
  assert.throws(() =>
    decryptMarketKey(a, "a-different-encryption-secret-32-bytes"),
  );
  assert.throws(() => decryptMarketKey(a.slice(0, -3) + "AAA", secret));
});
test("appraisal migration saves and reloads private snapshots, denies browser access, and detects concurrent updates", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
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
    const migration = await readFile(
      new URL(
        "../supabase/migrations/202610060001_appraisals.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.query("insert into auth.users values($1)", [staffId]);
    await pg.query(
      "insert into public.staff(id,email,name,role) values($1,'test@example.com','Test Owner','owner')",
      [staffId],
    );
    const data = fixture();
    data.manualComps = [comp(14000), comp(15000), comp(16000)];
    await pg.query(
      "insert into public.appraisal_records(id,vin,title,payload,created_by) values($1,$2,$3,$4,$5)",
      [
        recordId,
        data.subject.vin,
        "Test Appraisal",
        JSON.stringify(data),
        staffId,
      ],
    );
    const { rows } = await pg.query<{ payload: Appraisal; updated_at: string }>(
      "select payload,updated_at::text from public.appraisal_records where id=$1",
      [recordId],
    );
    assert.equal(
      appraisalNumbers(appraisalSchema.parse(rows[0].payload)).maxBuy,
      11000,
    );
    const updated = await pg.query(
      "update public.appraisal_records set updated_at=now()+interval '1 second' where id=$1 and updated_at=$2::timestamptz returning id",
      [recordId, rows[0].updated_at],
    );
    assert.equal(updated.rows.length, 1);
    const stale = await pg.query(
      "update public.appraisal_records set title='Stale' where id=$1 and updated_at=$2::timestamptz returning id",
      [recordId, rows[0].updated_at],
    );
    assert.equal(stale.rows.length, 0);
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      for (const table of [
        "appraisal_records",
        "appraisal_connections",
        "appraisal_market_cache",
      ])
        await assert.rejects(
          pg.query(`select * from public.${table}`),
          /permission denied/,
        );
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    assert.equal(
      (await pg.query("select id from public.appraisal_records")).rows.length,
      1,
    );
    await pg.exec("reset role");
  } finally {
    await pg.close();
  }
});
