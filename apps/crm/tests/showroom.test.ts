import assert from "node:assert/strict";
import test from "node:test";
import { demoWorkspace } from "../lib/demo";
import type { Visit } from "../lib/model";
import { showroomVisitContext } from "../lib/showroom";
import { inventorySnapshot, vehicleName } from "../lib/vehicles";

function fixture() {
  const ws = demoWorkspace();
  const opportunity = {
    ...ws.opportunities[0],
    status: "working" as const,
    inventory_id: ws.inventory[0].id,
    vehicle_interest: vehicleName(ws.inventory[0]),
    vehicle_details: inventorySnapshot(ws.inventory[0]),
  };
  ws.opportunities = [opportunity];
  const visit: Visit = {
    id: "visit",
    org_id: ws.org.id,
    customer_id: opportunity.customer_id,
    opportunity_id: null,
    arrived_at: "2026-10-27T18:50:00Z",
    departed_at: null,
    outcome: "browsing",
  };
  return { ws, opportunity, visit };
}

test("general check-in shows the customer's sole active opportunity and follows vehicle changes", () => {
  const { ws, opportunity, visit } = fixture();
  ws.opportunities.push({
    ...opportunity,
    id: "older",
    status: "lost",
    inventory_id: null,
    vehicle_interest: "",
  });
  const result = showroomVisitContext(visit, ws);
  assert.equal(result.opportunity?.id, opportunity.id);
  assert.equal(result.vehicleLabel, vehicleName(ws.inventory[0]));
  opportunity.inventory_id = ws.inventory[1].id;
  assert.equal(
    showroomVisitContext(visit, ws).vehicleLabel,
    vehicleName(ws.inventory[1]),
  );
  assert.equal(
    visit.opportunity_id,
    null,
    "display resolution does not rewrite visit history",
  );
});

test("multiple open opportunities require a choice, while an explicit visit link wins", () => {
  const { ws, opportunity, visit } = fixture();
  const other = {
    ...opportunity,
    id: "another",
    inventory_id: ws.inventory[1].id,
  };
  ws.opportunities.push(other);
  let result = showroomVisitContext(visit, ws);
  assert.equal(result.opportunity, undefined);
  assert.equal(result.choices.length, 2);
  visit.opportunity_id = other.id;
  result = showroomVisitContext(visit, ws);
  assert.equal(result.opportunity?.id, other.id);
  assert.equal(result.vehicleLabel, vehicleName(ws.inventory[1]));
  assert.equal(result.choices.length, 0);
});

test("finished general visits and sold visits never borrow a later active vehicle", () => {
  const { ws, visit } = fixture();
  visit.departed_at = "2026-10-27T19:50:00Z";
  assert.equal(showroomVisitContext(visit, ws).opportunity, undefined);
  visit.departed_at = null;
  visit.outcome = "sold";
  assert.equal(showroomVisitContext(visit, ws).opportunity, undefined);
});

test("linked closed deals use their vehicle snapshot instead of changed live inventory", () => {
  const { ws, opportunity, visit } = fixture();
  visit.opportunity_id = opportunity.id;
  const original = opportunity.vehicle_interest;
  ws.opportunities = [{ ...opportunity, status: "sold" }];
  ws.inventory[0] = { ...ws.inventory[0], model: "Changed inventory label" };
  assert.equal(showroomVisitContext(visit, ws).vehicleLabel, original);
  ws.opportunities[0].status = "lost";
  assert.equal(showroomVisitContext(visit, ws).vehicleLabel, original);
});

test("manual vehicle descriptions and genuinely unselected vehicles are handled", () => {
  const { ws, opportunity, visit } = fixture();
  ws.opportunities = [
    {
      ...opportunity,
      inventory_id: null,
      vehicle_details: null,
      vehicle_interest: "2018 Nissan Versa",
    },
  ];
  assert.equal(
    showroomVisitContext(visit, ws).vehicleLabel,
    "2018 Nissan Versa",
  );
  ws.opportunities[0].vehicle_interest = "";
  assert.equal(
    showroomVisitContext(visit, ws).vehicleLabel,
    "Vehicle to be selected",
  );
});

test("other customers, other dealerships, and unavailable explicit links cannot supply a vehicle", () => {
  const { ws, opportunity, visit } = fixture();
  ws.opportunities = [
    { ...opportunity, customer_id: "someone-else" },
    { ...opportunity, org_id: "another-dealership" },
  ];
  assert.equal(showroomVisitContext(visit, ws).opportunity, undefined);
  ws.opportunities = [opportunity];
  visit.opportunity_id = "unavailable";
  assert.equal(showroomVisitContext(visit, ws).opportunity, undefined);
});
