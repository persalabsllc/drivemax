import "server-only";
import { createHash } from "node:crypto";
import { marketSchema, type MarketSnapshot, type Subject } from "./appraisal";
import {
  marketSearchParams,
  parseMarketListings,
  parsePrediction,
} from "./appraisal-provider";
import { appraisalPool } from "./appraisal-store";

export async function marketCheckJson(
  path: string,
  params: URLSearchParams,
  key: string,
): Promise<unknown> {
  const url = new URL(`https://api.marketcheck.com${path}`);
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
            ? "MarketCheck credits or rate limit reached. Try again later."
            : "MarketCheck could not value this vehicle right now. Manual comparables are still available.",
    );
  return response.json();
}
export async function fetchMarketSnapshot(
  subject: Subject,
  key: string,
): Promise<MarketSnapshot> {
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(subject))
    .digest("hex");
  const cached = await appraisalPool().query<{ payload: unknown }>(
    "select payload from public.appraisal_market_cache where key=$1 and expires_at>now()",
    [cacheKey],
  );
  const parsed = marketSchema.safeParse(cached.rows[0]?.payload);
  if (parsed.success) return parsed.data;
  const [search, prediction] = await Promise.allSettled([
    marketCheckJson("/v2/search/car/active", marketSearchParams(subject), key),
    marketCheckJson(
      "/v2/predict/car/us/marketcheck_price",
      new URLSearchParams({
        vin: subject.vin,
        miles: String(subject.miles),
        zip: subject.zip,
        dealer_type: "independent",
        is_certified: "false",
      }),
      key,
    ),
  ]);
  const warnings: string[] = [];
  const error = (value: unknown) =>
    value instanceof Error && !/abort|timeout|fetch/i.test(value.message)
      ? value.message
      : "The market-data request timed out. Try again later.";
  if (search.status === "rejected") warnings.push(error(search.reason));
  if (prediction.status === "rejected") warnings.push(error(prediction.reason));
  if (search.status === "rejected" && prediction.status === "rejected")
    throw new Error(warnings[0]);
  const fetchedAt = new Date().toISOString();
  const comps =
    search.status === "fulfilled"
      ? parseMarketListings(search.value, subject, fetchedAt)
      : { listings: [], totalFound: 0 };
  const predictedPrice =
    prediction.status === "fulfilled"
      ? parsePrediction(prediction.value)
      : null;
  if (prediction.status === "fulfilled" && predictedPrice === null)
    warnings.push(
      "MarketCheck returned no usable market estimate for this VIN.",
    );
  const snapshot: MarketSnapshot = {
    query: subject,
    fetchedAt,
    predictedPrice,
    ...comps,
    warnings,
  };
  // Keep partial responses uncached so a failed endpoint can be retried immediately.
  if (!warnings.length) {
    await appraisalPool().query(
      "delete from public.appraisal_market_cache where expires_at<now()",
    );
    await appraisalPool().query(
      "insert into public.appraisal_market_cache(key,payload,expires_at) values($1,$2,now()+interval '6 hours') on conflict(key) do update set payload=excluded.payload,expires_at=excluded.expires_at",
      [cacheKey, JSON.stringify(snapshot)],
    );
  }
  return snapshot;
}
