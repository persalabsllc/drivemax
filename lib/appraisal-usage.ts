// Leave room within MarketCheck's 500-call free allowance for dashboard testing.
export const MARKET_MONTHLY_LIMIT = 450;
export type MarketUsage = { used: number; limit: number; resetsAt: string };
type Query = (
  sql: string,
  values: (string | number)[],
) => Promise<{ rows: { used: number }[] }>;

function period(now: Date) {
  return {
    month: now.toISOString().slice(0, 7),
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}
export async function marketUsage(
  query: Query,
  now = new Date(),
): Promise<MarketUsage> {
  const { month, resetsAt } = period(now);
  const { rows } = await query(
    "select used from public.appraisal_api_usage where month=$1",
    [month],
  );
  return { used: rows[0]?.used || 0, limit: MARKET_MONTHLY_LIMIT, resetsAt };
}
export async function reserveMarketRequest(query: Query, now = new Date()) {
  const { month } = period(now);
  // Reserve before sending, including failed attempts. This is shared by all
  // staff and connection checks, and cannot race past the monthly limit.
  const { rows } = await query(
    `insert into public.appraisal_api_usage(month,used) values($1,1)
     on conflict(month) do update set used=appraisal_api_usage.used+1
     where appraisal_api_usage.used<$2 returning used`,
    [month, MARKET_MONTHLY_LIMIT],
  );
  if (!rows.length)
    throw new Error(
      "MarketCheck monthly Drive Max request limit reached. Add comparables manually until the allowance resets next month.",
    );
}
