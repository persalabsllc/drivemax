import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { activateApprovedProtectionPricing } from "../../scripts/activate-approved-protection-pricing.mjs";

export async function verifyApprovedPricing(
  pg: PGlite,
  owner: string,
  sales: string,
) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const config = {
    rates: {
      deluxe: { basis: "annual_mileage", amount: 399 },
      platinum: { basis: "annual_mileage", amount: 599 },
      maintenance: { basis: "visit", amount: 125 },
      tire_wheel: { basis: "annual", amount: 87 },
      pdr: { basis: "annual", amount: 65 },
      appearance: { basis: "flat", amount: 199 },
      key_replacement: { basis: "annual", amount: 75 },
    },
    annual_miles: 12000,
    maintenance_interval: 5000,
    reserve_percent: 40,
    account_name: "Drive Max Protection Claims Fund",
  };
  const command = (p: Record<string, unknown>) =>
    pg.query("select dmcrm_command($1,$2,$3::jsonb)", [
      org,
      owner,
      JSON.stringify({ request_id: randomUUID(), ...p }),
    ]);
  const read = async () =>
    (
      await pg.query<{
        active: unknown;
        draft: unknown;
        revision: number;
        active_revision: number | null;
      }>(
        "select active,draft,revision,active_revision from dmcrm_product_pricing where org_id=$1",
        [org],
      )
    ).rows[0];
  const conflict = () =>
    assert.rejects(() => activateApprovedProtectionPricing(pg), {
      code: "APPROVED_PRICING_CONFLICT",
    });
  await pg.exec("savepoint approved_pricing_fixture");
  try {
    await conflict(); // A generic owner cannot stand in for this approval.
    for (const table of ["dmcrm_staff", "dmcrm_members"])
      await pg.query(
        `update ${table} set name='Kyle Kratoville' where org_id=$1 and user_id=$2`,
        [org, owner],
      );
    await pg.exec("savepoint approved_pricing_empty");
    for (const table of ["dmcrm_staff", "dmcrm_members"])
      await pg.query(
        `update ${table} set name='Kyle Kratoville',role='owner' where org_id=$1 and user_id=$2`,
        [org, sales],
      );
    await conflict(); // Ambiguous identities never select an arbitrary actor.
    await pg.exec("rollback to savepoint approved_pricing_empty");

    const changed = { ...config, reserve_percent: 45 };
    await command({
      type: "save_product_pricing",
      revision: 0,
      config: changed,
    });
    const before = await read();
    await conflict();
    assert.deepEqual(await read(), before);
    await command({
      type: "activate_product_pricing",
      revision: 1,
      approved: true,
    });
    await command({ type: "save_product_pricing", revision: 2, config });
    await conflict(); // An older/different active schedule also needs review.
    assert.deepEqual((await read()).active, changed);
    await pg.exec("rollback to savepoint approved_pricing_empty");

    // Handle an already-saved approved draft through the normal revision gate.
    await command({ type: "save_product_pricing", revision: 0, config });
    assert.deepEqual(await activateApprovedProtectionPricing(pg), {
      status: "activated",
      revision: 2,
    });
    assert.deepEqual((await read()).active, config);
    await pg.exec("rollback to savepoint approved_pricing_empty");

    // Fresh install saves, activates and verifies exactly the approved snapshot.
    assert.deepEqual(await activateApprovedProtectionPricing(pg), {
      status: "activated",
      revision: 2,
    });
    assert.deepEqual(await read(), {
      draft: config,
      active: config,
      revision: 2,
      active_revision: 2,
    });
    const events = await pg.query<{
      created_by: string;
      command: { approval_reference: string };
    }>("select created_by,command from dmcrm_pricing_events where org_id=$1", [
      org,
    ]);
    assert.equal(events.rows.length, 2);
    assert.ok(
      events.rows.every(
        (e) =>
          e.created_by === owner &&
          e.command.approval_reference.includes("ChatGPT on 2026-10-31"),
      ),
    );
    assert.equal(
      (
        await pg.query(
          "select id from dmcrm_protection_fund_entries where org_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(await activateApprovedProtectionPricing(pg), {
      status: "already_applied",
    });
    assert.equal((await read()).revision, 2);

    // A future owner edit or pause wins over a subsequent application deployment.
    await command({
      type: "save_product_pricing",
      revision: 2,
      config: changed,
    });
    await command({
      type: "activate_product_pricing",
      revision: 3,
      approved: true,
    });
    assert.deepEqual(await activateApprovedProtectionPricing(pg), {
      status: "already_applied",
    });
    assert.deepEqual((await read()).active, changed);
    await command({ type: "pause_product_pricing", revision: 4 });
    assert.deepEqual(await activateApprovedProtectionPricing(pg), {
      status: "already_applied",
    });
    assert.deepEqual(await read(), {
      draft: changed,
      active: null,
      revision: 5,
      active_revision: null,
    });
  } finally {
    await pg.exec("rollback to savepoint approved_pricing_fixture");
  }
}
