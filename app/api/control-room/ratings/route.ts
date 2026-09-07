import { staffSession } from "../../../../lib/backend";
import { takeSlot } from "../../../../lib/rate-limit";
import { nhtsaJson } from "../../../../lib/nhtsa";
import {
  parseSafetyRatings,
  safetyVariants,
} from "../../../../lib/vehicle-data";

export async function GET(request: Request) {
  const staff = await staffSession();
  if (!staff)
    return Response.json(
      { error: "Sign in to the Control Room to look up ratings." },
      { status: 401 },
    );
  const p = new URL(request.url).searchParams;
  const year = Number(p.get("year")),
    make = (p.get("make") || "").trim(),
    model = (p.get("model") || "").trim();
  if (
    !Number.isInteger(year) ||
    year < 1990 ||
    year > new Date().getFullYear() + 2 ||
    !make ||
    make.length > 60 ||
    !model ||
    model.length > 80
  )
    return Response.json(
      {
        error:
          "Enter the year, make, and model first. NHTSA ratings cover model years 1990 and newer.",
      },
      { status: 400 },
    );
  try {
    if (!(await takeSlot(staff.id, "safety-ratings", 120)))
      return Response.json(
        { error: "Please wait before looking up more ratings." },
        { status: 429 },
      );
    const variants = safetyVariants(
      await nhtsaJson(
        `https://api.nhtsa.gov/SafetyRatings/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}?format=json`,
      ),
    );
    if (!p.has("variant"))
      return Response.json(
        { variants },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const selected = variants.find((v) => v.id === Number(p.get("variant")));
    if (!selected)
      return Response.json(
        { error: "Choose a matching vehicle version from the list." },
        { status: 400 },
      );
    const ratings = parseSafetyRatings(
      await nhtsaJson(
        `https://api.nhtsa.gov/SafetyRatings/VehicleId/${selected.id}?format=json`,
      ),
      selected,
    );
    return Response.json(ratings, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "NHTSA ratings are temporarily unavailable. The vehicle can still be saved.",
      },
      { status: 502 },
    );
  }
}
