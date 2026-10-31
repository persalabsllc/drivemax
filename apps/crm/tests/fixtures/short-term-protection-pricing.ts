import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import {
  proposedPricing,
  protectionCost,
  type PricingConfig,
  type PricingSnapshot,
} from "../../lib/protection-pricing";

export async function verifyShortTermPricing(pg: PGlite, owner: string) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const migration = await fs.readFile(
    new URL("../../db/033_short_term_protection_pricing.sql", import.meta.url),
    "utf8",
  );
  const command = (p: Record<string, unknown>) =>
    pg.query("select dmcrm_command($1,$2,$3::jsonb)", [
      org,
      owner,
      JSON.stringify({ request_id: randomUUID(), ...p }),
    ]);
  const read = async () =>
    (
      await pg.query<{
        draft: PricingConfig;
        active: PricingConfig | null;
        revision: number;
        active_revision: number | null;
      }>(
        "select draft,active,revision,active_revision from dmcrm_product_pricing where org_id=$1",
        [org],
      )
    ).rows[0];
  await pg.exec("savepoint short_pricing_fixture");
  try {
    // Check exact JS / Postgres parity across odd terms, all deductibles and
    // mileage boundaries, including rounding after both adjustments.
    for (const plan of ["deluxe", "platinum"] as const) {
      for (const term of [1, 6, 7, 12, 24, 36, 60]) {
        for (const miles of [5000, 6000, 12000, 36000]) {
          for (const deductible of [0, 250, 500, 1000]) {
            const p = {
              protection_plan: plan,
              term_months: term,
              mileage_limit: miles,
              deductible,
              price: 800,
            };
            const result = await pg.query<{ value: PricingSnapshot }>(
              "select dmcrm_protection_cost($1::jsonb,$2::jsonb,3) value",
              [JSON.stringify(p), JSON.stringify(proposedPricing)],
            );
            assert.deepEqual(
              result.rows[0].value,
              protectionCost(p, proposedPricing, 3),
            );
          }
        }
      }
    }
    const legacy = structuredClone(proposedPricing);
    legacy.rates.deluxe.basis = "annual_mileage";
    legacy.rates.platinum.basis = "annual_mileage";
    delete legacy.deductible_discounts;
    await command({
      type: "save_product_pricing",
      revision: 0,
      config: legacy,
    });
    await command({
      type: "activate_product_pricing",
      revision: 1,
      approved: true,
    });
    const draft = structuredClone(legacy);
    draft.rates.deluxe.amount = 499;
    draft.reserve_percent = 45;
    await command({ type: "save_product_pricing", revision: 2, config: draft });
    for (const table of ["dmcrm_staff", "dmcrm_members"])
      await pg.query(
        `update ${table} set name='Kyle Kratoville' where org_id=$1 and user_id=$2`,
        [org, owner],
      );
    await pg.exec("savepoint before_short_pricing_upgrade");
    await pg.exec(migration);
    let saved = await read();
    assert.equal(saved.revision, 4);
    assert.equal(saved.active_revision, 4);
    assert.deepEqual(saved.active, proposedPricing);
    assert.equal(saved.draft.rates.deluxe.amount, 499);
    assert.equal(saved.draft.reserve_percent, 45);
    assert.equal(saved.draft.rates.deluxe.basis, "first_limit");
    const events = await pg.query<{
      created_by: string;
      command: { before_active: PricingConfig };
    }>(
      "select created_by,command from dmcrm_pricing_events where command->>'type'='correct_service_contract_pricing'",
    );
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].created_by, owner);
    assert.deepEqual(events.rows[0].command.before_active, legacy);
    await command({ type: "pause_product_pricing", revision: 4 });
    await pg.exec(migration);
    saved = await read();
    assert.equal(saved.revision, 5);
    assert.equal(saved.active, null);
    assert.equal(saved.draft.rates.deluxe.amount, 499);
    await pg.exec("rollback to savepoint before_short_pricing_upgrade");
    await command({ type: "pause_product_pricing", revision: 3 });
    await pg.exec(migration);
    saved = await read();
    assert.equal(saved.active, null);
    assert.equal(saved.active_revision, null);
    assert.equal(saved.draft.rates.deluxe.basis, "first_limit");
    assert.equal(saved.draft.rates.deluxe.amount, 499);
  } finally {
    await pg.exec("rollback to savepoint short_pricing_fixture");
  }
}
