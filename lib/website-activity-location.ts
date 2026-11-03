export type ActivityLocation = {
  city: string | null;
  region: string | null;
  country: string | null;
};

// Only use Vercel's request geolocation. Never collect GPS, postal codes,
// coordinates, or the visitor's raw IP for the activity record.
export function activityLocationFromHeaders(
  headers: Pick<Headers, "get">,
  onVercel: boolean,
): ActivityLocation {
  const empty = { city: null, region: null, country: null };
  if (!onVercel) return empty;
  const country = headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country) || country === "XX") return empty;
  const region = headers
    .get("x-vercel-ip-country-region")
    ?.trim()
    .toUpperCase();
  let city: string | null = null;
  const rawCity = headers.get("x-vercel-ip-city");
  if (rawCity && rawCity.length <= 720) {
    try {
      const decoded = decodeURIComponent(rawCity).normalize("NFC").trim();
      if (
        decoded.length > 0 &&
        decoded.length <= 120 &&
        !/[\u0000-\u001f\u007f<>]/.test(decoded) &&
        decoded.toLowerCase() !== "unknown"
      )
        city = decoded;
    } catch {
      // Missing or malformed geolocation must not interrupt visit recording.
    }
  }
  return {
    city,
    region: region && /^[A-Z0-9]{1,3}$/.test(region) ? region : null,
    country,
  };
}
