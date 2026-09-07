import { backendReady } from "../../lib/backend";
import LeadForm from "./LeadForm";
import type { LeadVehicle } from "../../lib/lead-vehicles";
export default function ConnectedLeadForm({
  kind,
  vehicleId,
  vehicle,
}: {
  kind: "vehicle" | "contact" | "finance" | "employment";
  vehicleId?: string;
  vehicle?: LeadVehicle;
}) {
  return (
    <LeadForm
      kind={kind}
      vehicleId={vehicleId}
      vehicle={
        vehicle
          ? {
              id: vehicle.id,
              slug: vehicle.slug,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              vin: vehicle.vin,
              stock_number: vehicle.stock_number,
              miles: vehicle.miles,
              status: vehicle.status,
            }
          : undefined
      }
      online={
        backendReady() &&
        !!process.env.LEAD_RATE_LIMIT_SECRET &&
        kind !== "employment"
      }
    />
  );
}
