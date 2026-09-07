import { backendReady } from "../../../../lib/backend";
import { takeSlot } from "../../../../lib/rate-limit";
import { nhtsaJson } from "../../../../lib/nhtsa";
import {
  decodeVpic,
  normalizeVin,
  VIN_PATTERN,
} from "../../../../lib/vehicle-data";

export async function GET(request: Request) {
  const vin = normalizeVin(new URL(request.url).searchParams.get("vin") || "");
  if (!VIN_PATTERN.test(vin))
    return Response.json(
      { error: "Enter a 17-character VIN without I, O, or Q." },
      { status: 400 },
    );
  try {
    if (!backendReady())
      return Response.json(
        {
          error:
            "VIN lookup is temporarily unavailable. You can enter the details manually.",
        },
        { status: 503 },
      );
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    if (!(await takeSlot(ip, "vin-lookup", 120)))
      return Response.json(
        {
          error:
            "Please wait before looking up another VIN. Manual entry is still available.",
        },
        { status: 429 },
      );
    const payload = await nhtsaJson(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
    );
    return Response.json(decodeVpic(payload, vin), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && !/timeout|abort|fetch/i.test(error.message)
            ? error.message
            : "VIN lookup took too long. Try again or enter the details manually.",
      },
      { status: 502 },
    );
  }
}
