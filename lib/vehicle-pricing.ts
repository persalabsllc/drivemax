// Inventory stores the vehicle price only. Never write the fee-inclusive total
// back to internet_price, or add this fee to a customer's purchase-offer request.
export const DEALER_ADMINISTRATION_FEE = 399;

export function totalVehiclePrice(vehiclePrice: number): number {
  return (
    (Math.round(vehiclePrice * 100) + DEALER_ADMINISTRATION_FEE * 100) / 100
  );
}

export function formatVehiclePrice(value: number): string {
  const cents = Math.round(value * 100);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
