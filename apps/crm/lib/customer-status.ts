import type { Opportunity } from "./model";
const labels = {
  appointment: "Appointment",
  working: "Working",
  new: "New",
  sold: "Sold",
  lost: "Lost",
} as const;
export function customerOpportunityBadges(
  opportunities: Opportunity[],
  customerId: string,
) {
  const counts = new Map<string, number>();
  for (const o of opportunities)
    if (o.customer_id === customerId)
      counts.set(o.status, (counts.get(o.status) || 0) + 1);
  const badges = (Object.keys(labels) as (keyof typeof labels)[])
    .filter((s) => counts.has(s))
    .map((status) => ({
      status,
      label: labels[status],
      count: counts.get(status)!,
    }));
  return { tone: badges[0]?.status || "none", badges };
}
