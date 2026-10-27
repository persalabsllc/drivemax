import { z } from "zod";
import {
  appraisalVehicleSchema,
  comparableSchema,
  safeResearchUrl,
  type Comparable,
} from "./appraisals";
import { vinSchema } from "./vehicles";
export const marketSearchSchema = z.object({
  vehicle: appraisalVehicleSchema,
  zip: z.string().regex(/^\d{5}$/),
  radius: z.number().int().min(10).max(500),
});
const listingSchema = z.object({
  vin: z.string().optional(),
  heading: z.string().optional(),
  price: z.number().positive().max(1000000),
  miles: z.number().int().min(0).max(3000000).optional(),
  vdp_url: z.string().optional(),
  source: z.string().optional(),
  dist: z.number().optional(),
  last_seen_at_date: z.string().optional(),
  build: z
    .object({
      year: z.number(),
      make: z.string(),
      model: z.string().optional(),
      trim: z.string().optional(),
    })
    .optional(),
});
export function parseMarketListings(body: unknown, date: string): Comparable[] {
  const result = z.object({ listings: z.array(z.unknown()) }).parse(body);
  const seen = new Set<string>();
  return result.listings
    .slice(0, 50)
    .flatMap((raw) => {
      const parsed = listingSchema.safeParse(raw);
      if (!parsed.success) return [];
      const r = parsed.data,
        vin = vinSchema.safeParse(r.vin),
        vehicle = (
          r.heading ||
          (r.build
            ? [r.build.year, r.build.make, r.build.model, r.build.trim]
                .filter(Boolean)
                .join(" ")
            : "")
        ).slice(0, 250);
      if (!vehicle) return [];
      const href = safeResearchUrl(r.vdp_url || ""),
        key = vin.success ? vin.data : href || vehicle + String(r.miles);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        comparableSchema.parse({
          id: crypto.randomUUID(),
          vehicle,
          vin: vin.success ? vin.data : "",
          mileage: r.miles ?? null,
          price: r.price,
          basis: "retail_asking",
          source: `MarketCheck · ${r.source || "dealer listing"}`.slice(0, 250),
          url: href,
          date,
          included: true,
          notes: [
            `Retrieved ${date}. Retail asking price, not a sold value.`,
            r.dist === undefined ? "" : `${r.dist.toFixed(1)} miles away.`,
            r.last_seen_at_date
              ? `Listing last seen ${r.last_seen_at_date.slice(0, 10)}.`
              : "",
            "Verify trim, condition and fees.",
          ]
            .filter(Boolean)
            .join(" "),
        }),
      ];
    })
    .slice(0, 10);
}
