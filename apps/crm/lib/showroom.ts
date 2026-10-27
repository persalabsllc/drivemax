import { opportunityOpen, type Visit, type Workspace } from "./model";
import { vehicleName } from "./vehicles";

// A general check-in can precede the opportunity. Resolve its live display from
// the customer's sole open deal without changing visit history or guessing
// between several deals. Explicit links always take precedence.
export function showroomVisitContext(
  visit: Visit,
  ws: Pick<Workspace, "opportunities" | "inventory">,
) {
  const customerOpportunities = ws.opportunities.filter(
    (o) => o.org_id === visit.org_id && o.customer_id === visit.customer_id,
  );
  const choices =
    !visit.opportunity_id && !visit.departed_at && visit.outcome !== "sold"
      ? customerOpportunities.filter(opportunityOpen)
      : [];
  const opportunity = visit.opportunity_id
    ? customerOpportunities.find((o) => o.id === visit.opportunity_id)
    : choices.length === 1
      ? choices[0]
      : undefined;
  const vehicle = opportunity
    ? ((opportunityOpen(opportunity)
        ? ws.inventory.find(
            (v) =>
              v.org_id === visit.org_id && v.id === opportunity.inventory_id,
          )
        : null) ?? opportunity.vehicle_details)
    : null;
  return {
    opportunity,
    choices: choices.length > 1 ? choices : [],
    vehicleLabel:
      (vehicle && vehicleName(vehicle)) ||
      opportunity?.vehicle_interest?.trim() ||
      "Vehicle to be selected",
  };
}
