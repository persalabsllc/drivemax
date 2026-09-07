import { backendReady, db } from "../../../lib/backend";
import { leadSchema } from "../../../lib/inventory";
import { takeSlot } from "../../../lib/rate-limit";
import { purchaseSummary } from "../../../lib/purchase-requests";
import {
  captureVehicleInquiry,
  leadVehicleColumns,
  type LeadVehicle,
} from "../../../lib/lead-vehicles";

export async function POST(request: Request) {
  if (!backendReady())
    return Response.json(
      {
        error:
          "Online submissions are not connected yet. Email sales@drivemaxusedcars.com.",
      },
      { status: 503 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Please submit from the Drive Max website." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 20000)
    return Response.json({ error: "Message is too long." }, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 20000)
      return Response.json({ error: "Message is too long." }, { status: 413 });
    const parsed = leadSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return Response.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    const v = parsed.data;
    if (v.website) return Response.json({ ok: true });
    if (v.purpose === "purchase-offer") {
      v.reason = "Sell us your car";
      v.message = purchaseSummary(v);
    }
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    if (
      !(await takeSlot(ip, "lead-ip", 20)) ||
      !(await takeSlot(v.email || v.phone, "lead-contact", 10))
    )
      return Response.json(
        { error: "Please try again later or email the dealership." },
        { status: 429 },
      );
    let payload: Record<string, unknown> = v;
    if (v.vehicleId) {
      const { data, error } = await db()
        .from("vehicles")
        .select(leadVehicleColumns)
        .eq("id", v.vehicleId)
        .in("status", ["available", "pending", "sold"])
        .maybeSingle();
      if (error || !data)
        return Response.json(
          { error: "This listing changed. Refresh the page and try again." },
          { status: 400 },
        );
      try {
        payload = captureVehicleInquiry(
          v,
          data as unknown as LeadVehicle,
          new Date().toISOString(),
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Please refresh this listing.",
          },
          { status: 409 },
        );
      }
    }
    const { error } = await db().rpc("submit_lead", { payload });
    if (error) throw error;
    return Response.json(
      { ok: true },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Your inquiry was not confirmed. Please try again or email sales@drivemaxusedcars.com.",
      },
      { status: 503 },
    );
  }
}
