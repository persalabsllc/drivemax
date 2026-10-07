import { compSchema, type AppraisalComp, type Subject } from "./appraisal";
import { VIN_PATTERN } from "./vehicle-data";

// MarketCheck groups driven-wheel configurations into FWD, RWD, and 4WD.
export function marketDrivetrain(value: string) {
  if (/\bFWD\b|front.*wheel/i.test(value)) return "FWD";
  if (/\bRWD\b|rear.*wheel/i.test(value)) return "RWD";
  if (/\b(AWD|4WD|4X4)\b|all.*wheel|four.*wheel/i.test(value)) return "4WD";
  return null;
}

type Row = Record<string, unknown>;
const obj = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const str = (v: unknown, max = 200) =>
  typeof v === "string" ? v.slice(0, max) : "";
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export function parseMarketListings(
  payload: unknown,
  subject: Subject,
  at: string,
): { listings: AppraisalComp[]; totalFound: number } {
  const root = obj(payload),
    raw = Array.isArray(root.listings) ? root.listings : [];
  const listings: AppraisalComp[] = [],
    seen = new Set<string>();
  for (const item of raw) {
    const row = obj(item),
      build = obj(row.build),
      dealer = obj(row.dealer);
    const vin = str(row.vin, 17).toUpperCase();
    if (
      !VIN_PATTERN.test(vin) ||
      vin === subject.vin ||
      seen.has(vin) ||
      !number(row.price) ||
      number(row.price)! <= 0
    )
      continue;
    if (
      number(build.year) !== subject.year ||
      str(build.make).toLowerCase() !== subject.make.toLowerCase() ||
      str(build.model).toLowerCase() !== subject.model.toLowerCase()
    )
      continue;
    if (
      subject.exactTrim &&
      subject.trim &&
      str(build.trim).toLowerCase() !== subject.trim.toLowerCase()
    )
      continue;
    if (
      number(row.miles) === null ||
      Math.abs(number(row.miles)! - subject.miles) > subject.mileageWindow
    )
      continue;
    const drive = marketDrivetrain(subject.drivetrain);
    if (drive && marketDrivetrain(str(build.drivetrain)) !== drive) continue;
    if (number(row.dist) !== null && number(row.dist)! > subject.radius)
      continue;
    const url = str(row.vdp_url, 2000);
    const parsed = compSchema.safeParse({
      id: str(row.id, 100) || vin,
      vin,
      title: [build.year, build.make, build.model, build.trim]
        .filter(Boolean)
        .join(" "),
      price: row.price,
      miles: number(row.miles),
      kind: "asking",
      source: "MarketCheck · dealer listing",
      date: at.slice(0, 10),
      url,
      dealer: [dealer.name, dealer.city, dealer.state]
        .filter((v) => typeof v === "string")
        .join(" · ")
        .slice(0, 200),
      distance: number(row.dist),
      daysOnMarket:
        number(row.dom_active) ?? number(row.dom) ?? number(row.dos_active),
      included: true,
      origin: "marketcheck",
    });
    if (parsed.success) {
      listings.push(parsed.data);
      seen.add(vin);
    }
  }
  return {
    listings: listings.slice(0, 50),
    totalFound: Math.max(
      0,
      Math.floor(number(root.num_found) ?? listings.length),
    ),
  };
}
export function parsePrediction(payload: unknown) {
  const price = number(obj(payload).marketcheck_price);
  return price !== null && price > 0 && price <= 2000000 ? price : null;
}
export function marketSearchParams(subject: Subject) {
  const params = new URLSearchParams({
    car_type: "used",
    year: String(subject.year),
    make: subject.make,
    model: subject.model,
    zip: subject.zip,
    radius: String(subject.radius),
    miles_range: `${Math.max(0, subject.miles - subject.mileageWindow)}-${subject.miles + subject.mileageWindow}`,
    rows: "50",
    sort_by: "dist",
    sort_order: "asc",
    dedup: "true",
    has_price: "true",
    has_miles: "true",
    exclude_certified: "true",
    carfax_clean_title: "true",
    exclude_sources: "drivemaxusedcars.com,www.drivemaxusedcars.com",
  });
  if (subject.exactTrim && subject.trim) params.set("trim", subject.trim);
  const drive = marketDrivetrain(subject.drivetrain);
  if (drive) params.set("drivetrain", drive);
  return params;
}
