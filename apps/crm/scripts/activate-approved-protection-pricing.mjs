import { isDeepStrictEqual } from "node:util";

// One-time production settings change, explicitly approved by Kyle in ChatGPT.
// Keep this snapshot independent of the editable defaults used by the UI.
const org = "d5a1c100-0000-4000-8000-000000000001";
const saveId = "f178c418-ee67-4874-a9d9-3b906ca233e6";
const activateId = "f178c418-ee67-4874-a9d9-3b906ca233e7";
const approval =
  "Owner confirmed protection cost schedule in ChatGPT on 2026-10-31";
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

// The caller supplies the production migration transaction. Use the same lock
// and audited commands as Settings; no contracts, quotes or cash entries change.
export async function activateApprovedProtectionPricing(client) {
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, message) => {
    if (!ok)
      throw Object.assign(new Error(message), {
        code: "APPROVED_PRICING_CONFLICT",
      });
  };
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('dmcrm:pricing:'||$1::text,0))",
    [org],
  );
  const prior = await one(
    "select org_id,command from dmcrm_pricing_events where id=$1",
    [activateId],
  );
  if (prior) {
    check(
      prior.org_id === org &&
        prior.command.type === "activate_product_pricing" &&
        prior.command.approved === true &&
        prior.command.approval_reference === approval &&
        isDeepStrictEqual(prior.command.approved_config, config),
      "Approval request key already belongs to a different action",
    );
    // This marker survives later rate edits and pauses. Never reapply this
    // approval merely because the current schedule differs or is inactive.
    return { status: "already_applied" };
  }
  const { rows: owners } = await client.query(
    "select s.user_id from dmcrm_staff s join dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' and m.role='owner' and s.name='Kyle Kratoville' and m.name='Kyle Kratoville'",
    [org],
  );
  check(owners.length === 1, "The approving owner must be uniquely identified");
  const command = (p) =>
    one("select dmcrm_command($1,$2,$3::jsonb)", [
      org,
      owners[0].user_id,
      JSON.stringify(p),
    ]);
  let settings = await one(
    "select * from dmcrm_product_pricing where org_id=$1 for update",
    [org],
  );
  if (settings) {
    check(
      isDeepStrictEqual(settings.draft, config) &&
        (settings.active === null ||
          isDeepStrictEqual(settings.active, config)),
      "Protection pricing changed since approval; preserve the current settings",
    );
  } else {
    await command({
      type: "save_product_pricing",
      request_id: saveId,
      revision: 0,
      config,
      approval_reference: approval,
    });
    settings = await one(
      "select * from dmcrm_product_pricing where org_id=$1",
      [org],
    );
  }
  await command({
    type: "activate_product_pricing",
    request_id: activateId,
    revision: settings.revision,
    approved: true,
    approval_reference: approval,
    approved_config: config,
  });
  const activated = await one(
    "select active,active_revision,revision from dmcrm_product_pricing where org_id=$1",
    [org],
  );
  check(
    isDeepStrictEqual(activated?.active, config) &&
      activated.active_revision === settings.revision + 1 &&
      activated.revision === activated.active_revision,
    "Approved schedule did not activate exactly as confirmed",
  );
  return { status: "activated", revision: activated.active_revision };
}
