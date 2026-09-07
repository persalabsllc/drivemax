import { backendReady } from "../../lib/backend";
import LeadForm from "./LeadForm";
export default function ConnectedLeadForm({
  kind,
  vehicleId,
}: {
  kind: "vehicle" | "contact" | "finance" | "employment";
  vehicleId?: string;
}) {
  return (
    <LeadForm
      kind={kind}
      vehicleId={vehicleId}
      online={
        backendReady() &&
        !!process.env.LEAD_RATE_LIMIT_SECRET &&
        kind !== "employment"
      }
    />
  );
}
