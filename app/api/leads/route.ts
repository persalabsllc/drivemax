import { backendReady, db } from "../../../lib/backend";
import { leadSchema } from "../../../lib/inventory";
import { takeSlot } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  if (!backendReady())
    return Response.json(
      {
        error:
          "Online submissions are not connected yet. Email hello@drivemaxusedcars.com.",
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
    if (v.vehicleId) {
      const { data, error } = await db()
        .from("vehicles")
        .select("status")
        .eq("id", v.vehicleId)
        .in("status", ["available", "pending", "sold"])
        .maybeSingle();
      if (error || !data)
        return Response.json(
          { error: "This listing changed. Refresh the page and try again." },
          { status: 400 },
        );
      // Sold inquiries are explicitly requests for a similar vehicle, never reservations.
      if (data.status === "sold")
        v.reason = "Request a vehicle similar to this sold listing";
    }
    const { error } = await db().rpc("submit_lead", { payload: v });
    if (error) throw error;
    return Response.json(
      { ok: true },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Your inquiry was not confirmed. Please try again or email hello@drivemaxusedcars.com.",
      },
      { status: 503 },
    );
  }
}
