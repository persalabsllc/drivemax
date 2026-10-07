import "server-only";
import { type MarketSnapshot, type Subject } from "./appraisal";
import { marketSearchParams, parseMarketListings } from "./appraisal-provider";
import { appraisalPool } from "./appraisal-store";
import { marketUsage, reserveMarketRequest } from "./appraisal-usage";

export function currentMarketUsage() {
  return marketUsage((sql, values) => appraisalPool().query(sql, values));
}

export async function marketCheckJson(
  params: URLSearchParams,
  key: string,
): Promise<unknown> {
  // Only inventory search is used. Never call a paid prediction or book feed.
  await reserveMarketRequest((sql, values) =>
    appraisalPool().query(sql, values),
  );
  const url = new URL("https://api.marketcheck.com/v2/search/car/active");
  url.search = params.toString();
  url.searchParams.set("api_key", key);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "MarketCheck did not accept the API key. Reconnect your account."
        : response.status === 403
          ? "Your MarketCheck plan does not include this endpoint. Check account access."
          : response.status === 429
            ? "MarketCheck monthly allowance or rate limit reached. Add manual comparables or try again later."
            : "MarketCheck could not retrieve listings right now. Manual comparables are still available.",
    );
  return response.json();
}
export async function fetchMarketSnapshot(
  subject: Subject,
  key: string,
): Promise<MarketSnapshot> {
  if (subject.radius > 100)
    throw new Error(
      "MarketCheck free searches are limited to 100 miles. Choose a smaller radius or add wider-area comparables manually.",
    );
  const search = await marketCheckJson(marketSearchParams(subject), key);
  const fetchedAt = new Date().toISOString();
  // Provider data is transient. Retail recommendations come from included
  // asking-price comparisons, not a proprietary prediction endpoint.
  return {
    query: subject,
    fetchedAt,
    predictedPrice: null,
    ...parseMarketListings(search, subject, fetchedAt),
    warnings: [],
  };
}
