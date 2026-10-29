import type { Insurance } from "./people";
import {
  matchingInsuranceCard,
  type InsuranceCapture,
  type SavedInsuranceCard,
} from "./insurance-scan";
const cards = new Map<string, (SavedInsuranceCard & { url: string })[]>();
export function insuranceImageUrl(card: SavedInsuranceCard, demo: boolean) {
  return demo
    ? ([...cards.values()].flat().find((c) => c.id === card.id)?.url ?? "")
    : `/api/customer-insurance/${card.id}`;
}
export async function customerInsurance(
  customerId: string,
  opportunityId: string | null,
  demo: boolean,
  policy: Partial<Insurance> | null | undefined,
  signal?: AbortSignal,
  cutoff?: string | null,
): Promise<SavedInsuranceCard | null> {
  if (demo)
    return matchingInsuranceCard(
      cards.get(customerId) ?? [],
      policy,
      opportunityId,
      cutoff,
    );
  const params = new URLSearchParams({ customer_id: customerId });
  if (opportunityId) params.set("opportunity_id", opportunityId);
  const response = await fetch(`/api/customer-insurance?${params}`, {
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Insurance card could not be loaded.");
  return data.card;
}
export async function saveCustomerInsurance(
  customerId: string,
  opportunityId: string | null,
  capture: InsuranceCapture,
  insurance: Insurance,
  demo: boolean,
) {
  if (demo) {
    const existing = cards.get(customerId) ?? [];
    if (!existing.some((c) => c.id === capture.id))
      cards.set(customerId, [
        {
          id: capture.id,
          opportunity_id: opportunityId,
          insurance_values: structuredClone(insurance),
          created_at: new Date().toISOString(),
          url: URL.createObjectURL(capture.file),
        },
        ...existing,
      ]);
    return;
  }
  const form = new FormData();
  form.set("id", capture.id);
  form.set("customer_id", customerId);
  if (opportunityId) form.set("opportunity_id", opportunityId);
  form.set("insurance", JSON.stringify(insurance));
  form.set("file", capture.file);
  const response = await fetch("/api/customer-insurance", {
    method: "POST",
    body: form,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.error || "Your policy is saved. Retry the insurance card upload.",
    );
}
