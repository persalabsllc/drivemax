import {
  DEALER_ADMINISTRATION_FEE,
  formatVehiclePrice,
  totalVehiclePrice,
} from "../../lib/vehicle-pricing";

export default function VehiclePricing({
  price,
  prominent = false,
}: {
  price: number;
  prominent?: boolean;
}) {
  return (
    <div
      className={`vehicle-pricing${prominent ? " vehicle-pricing-prominent" : ""}`}
    >
      <dl>
        <div className="vehicle-pricing-row">
          <dt>Vehicle price</dt>
          <dd>{formatVehiclePrice(price)}</dd>
        </div>
        <div className="vehicle-pricing-row">
          <dt>Dealer administration fee</dt>
          <dd>{formatVehiclePrice(DEALER_ADMINISTRATION_FEE)}</dd>
        </div>
        <div className="vehicle-pricing-row vehicle-pricing-total">
          <dt>Total price</dt>
          <dd>{formatVehiclePrice(totalVehiclePrice(price))}</dd>
        </div>
      </dl>
      <p className="vehicle-pricing-tax-note">Plus tax and tags.</p>
    </div>
  );
}
