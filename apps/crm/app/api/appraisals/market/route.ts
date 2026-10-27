import { NextRequest, NextResponse } from "next/server";
import { session } from "../../../../lib/server";
import { canManage, dayKey } from "../../../../lib/model";
import {
  marketSearchSchema,
  parseMarketListings,
} from "../../../../lib/appraisal-market";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const s = await session();
  if (!s) return json({ error: "Sign in to research vehicles." }, 401);
  return json({
    connected: !!process.env.MARKETCHECK_API_KEY,
    canSearch: canManage(s.role),
  });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to research vehicles." }, 401);
    if (!canManage(s.role))
      return json({ error: "Manager access required" }, 403);
    const key = process.env.MARKETCHECK_API_KEY;
    if (!key)
      return json(
        {
          error:
            "The live market feed is not connected. You can add comparable listings manually.",
        },
        503,
      );
    const raw = await req.text();
    if (raw.length > 10000)
      return json({ error: "Request is too large." }, 413);
    const p = marketSearchSchema.safeParse(JSON.parse(raw));
    if (!p.success)
      return json(
        {
          error: "Complete year, make, model, ZIP and radius before searching.",
        },
        400,
      );
    const v = p.data.vehicle;
    const url = new URL("https://api.marketcheck.com/v2/search/car/active");
    url.search = new URLSearchParams({
      api_key: key,
      append_api_key: "false",
      year: String(v.year),
      make: v.make,
      model: v.model,
      ...(v.trim ? { trim: v.trim } : {}),
      zip: p.data.zip,
      radius: String(p.data.radius),
      car_type: "used",
      country: "us",
      rows: "10",
      start: "0",
      has_price: "true",
      dedup: "true",
      sort_by: "dist",
      sort_order: "asc",
    }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      return json(
        {
          error:
            "The market provider could not complete this search. Check the connected plan or try again later.",
        },
        502,
      );
    return json({
      comparables: parseMarketListings(await response.json(), dayKey()),
      searched: { ...p.data, retrieved_at: new Date().toISOString() },
    });
  } catch {
    return json(
      {
        error:
          "Market search is temporarily unavailable. Your saved research is unchanged.",
      },
      503,
    );
  }
}
