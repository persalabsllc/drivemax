import { NextRequest, NextResponse } from "next/server";
import { session } from "../../../lib/server";
import { specsLookupSchema } from "../../../lib/vehicle-specifications";
import {
  lookupEpaVehicle,
  lookupStickerSpecs,
} from "../../../lib/vehicle-specifications-service";

export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  try {
    if (!(await session()))
      return json({ error: "Sign in to look up vehicle specifications." }, 401);
    const parsed = specsLookupSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success)
      return json(
        {
          error:
            "Save a valid VIN, year, make and model before looking up specifications.",
        },
        400,
      );
    const id = req.nextUrl.searchParams.get("epaId");
    if (id !== null && !/^\d{1,6}$/.test(id))
      return json({ error: "Choose a valid EPA configuration." }, 400);
    if (id) {
      try {
        return json({ specs: await lookupEpaVehicle(parsed.data, id) });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error &&
              /match|ratings|fuel type/.test(error.message)
                ? error.message
                : "EPA ratings are temporarily unavailable. Retry or enter verified ratings manually.",
          },
          422,
        );
      }
    }
    return json(await lookupStickerSpecs(parsed.data));
  } catch {
    return json(
      {
        error:
          "Vehicle lookup is temporarily unavailable. You can still enter details and print.",
      },
      503,
    );
  }
}
