import { NextRequest, NextResponse } from "next/server";
import { session } from "../../../lib/server";
import { vinSchema, parseVinDecode } from "../../../lib/vehicles";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  try {
    if (!(await session()))
      return json({ error: "Sign in to decode a VIN." }, 401);
    const parsed = vinSchema.safeParse(req.nextUrl.searchParams.get("vin"));
    if (!parsed.success)
      return json({ error: parsed.error.issues[0].message }, 400);
    const response = await fetch(
      "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/" +
        encodeURIComponent(parsed.data) +
        "?format=json",
      { signal: AbortSignal.timeout(10000), cache: "no-store" },
    );
    if (!response.ok)
      return json(
        {
          error:
            "The VIN decoder is temporarily unavailable. You can enter the vehicle details manually.",
        },
        502,
      );
    try {
      return json(parseVinDecode(await response.json(), parsed.data));
    } catch {
      return json(
        {
          error:
            "This VIN could not be decoded completely. Check the VIN or enter the vehicle details manually.",
        },
        422,
      );
    }
  } catch {
    return json(
      {
        error:
          "The VIN decoder is temporarily unavailable. You can enter the vehicle details manually.",
      },
      503,
    );
  }
}
