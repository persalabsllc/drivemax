import { fullMoney } from "../lib/model";
import type { PricingSnapshot } from "../lib/protection-pricing";

export function ProtectionCostSummary({
  snapshot: s,
  price,
}: {
  snapshot: PricingSnapshot;
  price: number;
}) {
  const floorApplies = s.reserve_floor > s.scheduled_cost;
  return (
    <div className="protection-cost-summary">
      <div className="protection-cost-figures">
        <div>
          <small>Calculated product cost</small>
          <strong>{fullMoney(s.scheduled_cost)}</strong>
          {s.deductible_discount_percent !== undefined && (
            <span>
              {s.deductible_discount_percent}% deductible discount · base{" "}
              {fullMoney(s.base_cost ?? s.scheduled_cost)}
            </span>
          )}
        </div>
        <div>
          <small>Claims fund allocation</small>
          <strong>{fullMoney(s.cost)}</strong>
          <span>Funding minimum: {fullMoney(s.reserve_floor)}</span>
        </div>
        <div>
          <small>Product gross after funding</small>
          <strong>{fullMoney(price - s.cost)}</strong>
          <span>Customer price less fund allocation</span>
        </div>
      </div>
      <p className="ops-help">
        {floorApplies
          ? "The funding minimum is higher than the calculated cost. A shorter term or higher deductible lowers the cost, but the amount set aside stays at this minimum. Adjust the funding percentage in Settings if needed."
          : "The calculated cost is allocated to the claims fund. Deductible discounts apply to Deluxe and Platinum service contracts."}{" "}
        Internal only; excluded from customer documents.
      </p>
    </div>
  );
}
