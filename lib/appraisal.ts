import { z } from "zod";
import { VIN_PATTERN } from "./vehicle-data";

const amount = z.number().finite().min(0).max(2000000);
const optionalAmount = amount.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const safeLink = z
  .string()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use a complete http or https listing URL.");

export const subjectSchema = z.object({
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(VIN_PATTERN, "Enter a complete 17-character VIN."),
  miles: z.number().int().min(0).max(2000000),
  year: z
    .number()
    .int()
    .min(1981)
    .max(new Date().getFullYear() + 2),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80),
  trim: z.string().trim().max(100),
  drivetrain: z.string().trim().max(60),
  zip: z.string().regex(/^\d{5}$/, "Enter a five-digit ZIP code."),
  radius: z.number().int().min(25).max(500),
  mileageWindow: z.number().int().min(5000).max(200000),
  exactTrim: z.boolean(),
});
export type Subject = z.infer<typeof subjectSchema>;

export const compSchema = z.object({
  id: z.string().min(1).max(100),
  vin: z.string().max(17).default(""),
  title: z.string().trim().min(1).max(240),
  price: amount.positive(),
  miles: z.number().int().min(0).max(2000000).nullable(),
  kind: z.enum(["asking", "sold"]),
  source: z.string().trim().min(1).max(120),
  date,
  url: safeLink.default(""),
  dealer: z.string().max(200).default(""),
  distance: z.number().finite().min(0).nullable().default(null),
  daysOnMarket: z.number().int().min(0).nullable().default(null),
  included: z.boolean().default(true),
  origin: z.enum(["marketcheck", "manual", "drivemax"]),
});
export type AppraisalComp = z.infer<typeof compSchema>;
export const marketSchema = z.object({
  fetchedAt: z.string().datetime(),
  query: subjectSchema,
  predictedPrice: optionalAmount,
  totalFound: z.number().int().min(0),
  listings: z.array(compSchema).max(50),
  warnings: z.array(z.string().max(500)).max(10),
});
export type MarketSnapshot = z.infer<typeof marketSchema>;
export const appraisalSchema = z
  .object({
    subject: subjectSchema,
    purpose: z.enum(["trade", "purchase", "inventory"]),
    condition: z.enum(["clean", "average", "rough"]),
    titleStatus: z.enum(["clean", "branded", "unknown"]),
    notes: z.string().max(6000),
    book: z.object({
      source: z.string().trim().max(120),
      asOf: z.union([date, z.literal("")]),
      roughTrade: optionalAmount,
      averageTrade: optionalAmount,
      cleanTrade: optionalAmount,
      loan: optionalAmount,
      retail: optionalAmount,
      wholesale: optionalAmount,
    }),
    costs: z.object({
      recon: amount,
      fees: amount,
      transport: amount,
      profit: amount,
      reserve: amount,
      acquisition: optionalAmount,
      mileageAdjustment: z.number().finite().min(0).max(1000),
      retailAdjustment: z.number().finite().min(-2000000).max(2000000),
    }),
    strategy: z.enum(["quick", "balanced", "margin"]),
    retailOverride: optionalAmount,
    reviewedMarketPrice: z.boolean().default(false),
    manualComps: z.array(compSchema).max(100),
    excludedCompIds: z.array(z.string().max(100)).max(250).default([]),
    internalSales: z.array(compSchema).max(200).default([]),
    market: marketSchema.nullable(),
    sale: z.object({
      price: optionalAmount,
      date: z.union([date, z.literal("")]),
    }),
  })
  .superRefine((data, ctx) => {
    if (
      Object.entries(data.book).some(
        ([key, value]) => !["source", "asOf"].includes(key) && value !== null,
      ) &&
      (!data.book.source || !data.book.asOf)
    )
      ctx.addIssue({
        code: "custom",
        message: "Add the book-value source and date.",
      });
    if (data.sale.price !== null && (!data.sale.date || data.sale.price <= 0))
      ctx.addIssue({
        code: "custom",
        message:
          "A recorded sale needs a positive vehicle price and sale date.",
      });
    const today = new Date().toISOString().slice(0, 10);
    for (const value of [
      data.book.asOf,
      data.sale.date,
      ...data.manualComps.map((c) => c.date),
    ])
      if (
        value &&
        (value > today ||
          !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
          new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value)
      )
        ctx.addIssue({
          code: "custom",
          message: "Use a valid date that is today or earlier.",
        });
  });
export type Appraisal = z.infer<typeof appraisalSchema>;
export type SavedAppraisal = {
  id: string;
  vehicleId: string | null;
  updatedAt: string;
  title: string;
  data: Appraisal;
};

export function sameMarketSubject(a: Subject, b: Subject) {
  return Object.keys(a).every(
    (key) => a[key as keyof Subject] === b[key as keyof Subject],
  );
}
export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    n = (sorted.length - 1) * p,
    lower = Math.floor(n);
  return sorted[lower] + (sorted[Math.ceil(n)] - sorted[lower]) * (n - lower);
}
export function adjustedCompPrice(
  comp: AppraisalComp,
  miles: number,
  perThousand: number,
) {
  return Math.max(
    0,
    comp.price +
      (comp.miles === null ? 0 : ((comp.miles - miles) / 1000) * perThousand),
  );
}
export function deduplicateComps(comps: AppraisalComp[], vin: string) {
  const seen = new Set<string>();
  return comps.filter((c) => {
    if (!c.included || (c.vin && c.vin.toUpperCase() === vin.toUpperCase()))
      return false;
    const key = `${c.kind}:${c.vin ? c.vin.toUpperCase() : c.url || c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function appraisalNumbers(
  data: Appraisal,
  ownSales: AppraisalComp[] = data.internalSales,
) {
  const marketCurrent =
    !!data.market && sameMarketSubject(data.subject, data.market.query);
  const comps = deduplicateComps(
    [
      ...(marketCurrent ? data.market!.listings : []),
      ...data.manualComps,
      ...ownSales,
    ].map((c) => ({
      ...c,
      included: c.included && !data.excludedCompIds.includes(c.id),
    })),
    data.subject.vin,
  );
  const prices = (kind: AppraisalComp["kind"]) =>
    comps
      .filter((c) => c.kind === kind)
      .map((c) =>
        adjustedCompPrice(c, data.subject.miles, data.costs.mileageAdjustment),
      );
  const asking = prices("asking"),
    sold = prices("sold"),
    medianAsk = quantile(asking, 0.5),
    medianSold = quantile(sold, 0.5);
  const predictedPrice = marketCurrent ? data.market!.predictedPrice : null;
  const percentile = { quick: 0.25, balanced: 0.5, margin: 0.75 }[
    data.strategy
  ];
  // Never treat advertised or delisted prices as confirmed sale transactions.
  let basis: string = "No pricing evidence yet";
  let base: number | null = null;
  if (asking.length >= 3) {
    base = quantile(asking, percentile);
    basis = `${data.strategy === "quick" ? "25th" : data.strategy === "margin" ? "75th" : "50th"} percentile of ${asking.length} included asking prices`;
  } else if (predictedPrice !== null) {
    base =
      predictedPrice *
      (data.strategy === "quick"
        ? 0.97
        : data.strategy === "margin"
          ? 1.03
          : 1);
    basis = "MarketCheck estimate with your pricing strategy";
  } else if (asking.length) {
    base = quantile(asking, percentile);
    basis = `Small sample: ${asking.length} included asking price${asking.length === 1 ? "" : "s"}`;
  } else if (sold.length) {
    base = quantile(sold, percentile);
    basis = `${sold.length} recorded sale${sold.length === 1 ? "" : "s"}; confirm comparability`;
  } else if (data.book.retail !== null) {
    base = data.book.retail;
    basis = "Manually entered book retail";
  }
  if (data.retailOverride !== null) {
    base = data.retailOverride;
    basis = data.reviewedMarketPrice
      ? "Your saved reviewed market price"
      : "Your retail override";
  }
  const retail =
    base === null
      ? null
      : Math.max(0, Math.round(base + data.costs.retailAdjustment));
  const expectedSale =
    retail === null ? null : Math.max(0, retail - data.costs.reserve);
  const expenses = data.costs.recon + data.costs.fees + data.costs.transport;
  const rawMaxBuy =
    expectedSale === null ? null : expectedSale - expenses - data.costs.profit;
  const maxBuy =
    rawMaxBuy === null ? null : Math.max(0, Math.floor(rawMaxBuy / 50) * 50);
  const allIn =
    data.costs.acquisition === null ? null : data.costs.acquisition + expenses;
  const gross =
    expectedSale === null || allIn === null ? null : expectedSale - allIn;
  const rank =
    retail === null || !asking.length
      ? null
      : 1 + asking.filter((p) => p < retail).length;
  return {
    marketCurrent,
    comps,
    askingCount: asking.length,
    soldCount: sold.length,
    medianAsk,
    medianSold,
    askingLow: quantile(asking, 0.25),
    askingHigh: quantile(asking, 0.75),
    predictedPrice,
    retail,
    expectedSale,
    expenses,
    maxBuy,
    rawMaxBuy,
    allIn,
    gross,
    rank,
    rankTotal: asking.length + 1,
    basis,
  };
}

// Save the operator's reviewed price, never a reusable archive of API listings.
export function appraisalForStorage(data: Appraisal): Appraisal {
  const numbers = appraisalNumbers(data);
  const reviewedRetail =
    data.retailOverride === null &&
    data.titleStatus === "clean" &&
    numbers.marketCurrent &&
    Date.now() - Date.parse(data.market!.fetchedAt) <= 86400000 &&
    numbers.retail !== null
      ? Math.max(0, numbers.retail - data.costs.retailAdjustment)
      : data.retailOverride;
  return {
    ...data,
    market: null,
    retailOverride: reviewedRetail,
    reviewedMarketPrice:
      reviewedRetail !== data.retailOverride || data.reviewedMarketPrice,
    manualComps: data.manualComps.filter((c) => c.origin !== "marketcheck"),
    internalSales: data.internalSales.filter((c) => c.origin !== "marketcheck"),
    excludedCompIds: data.excludedCompIds.filter((id) =>
      [...data.manualComps, ...data.internalSales].some(
        (c) => c.id === id && c.origin !== "marketcheck",
      ),
    ),
  };
}

export function newAppraisal(): Appraisal {
  return {
    subject: {
      vin: "",
      miles: 0,
      year: new Date().getFullYear(),
      make: "",
      model: "",
      trim: "",
      drivetrain: "",
      zip: "28562",
      radius: 100,
      mileageWindow: 30000,
      exactTrim: true,
    },
    purpose: "trade",
    condition: "average",
    titleStatus: "clean",
    notes: "",
    book: {
      source: "",
      asOf: "",
      roughTrade: null,
      averageTrade: null,
      cleanTrade: null,
      loan: null,
      retail: null,
      wholesale: null,
    },
    costs: {
      recon: 750,
      fees: 250,
      transport: 0,
      profit: 2500,
      reserve: 500,
      acquisition: null,
      mileageAdjustment: 0,
      retailAdjustment: 0,
    },
    strategy: "balanced",
    retailOverride: null,
    reviewedMarketPrice: false,
    manualComps: [],
    excludedCompIds: [],
    internalSales: [],
    market: null,
    sale: { price: null, date: "" },
  };
}
