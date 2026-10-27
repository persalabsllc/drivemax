import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../lib/server";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return new Response("Appointment unavailable", { status: 404, headers });
  const { data, error } = await db().rpc("dmcrm_public_appointment", {
    p_token: token,
  });
  if (error || !data || !["scheduled", "confirmed"].includes(data.status))
    return new Response("Appointment unavailable", { status: 404, headers });
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const start = new Date(data.starts_at),
    end = new Date(start.getTime() + data.duration_minutes * 60000);
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Drive Max//Appointments//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${token}@crm.drivemaxusedcars.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    "SUMMARY:Drive Max appointment",
    "LOCATION:6210 Old US Hwy 70 W\\, New Bern\\, NC 28562",
    "DESCRIPTION:Call (252) 541-0040 with questions.",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return new Response(content, {
    headers: {
      ...headers,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=Drive-Max-Appointment.ics",
    },
  });
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return NextResponse.json(
      { error: "Invalid origin" },
      { status: 403, headers },
    );
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return NextResponse.json(
      { error: "Appointment unavailable" },
      { status: 404, headers },
    );
  try {
    if (Number(req.headers.get("content-length")) > 3000) throw Error();
    const raw = await req.text();
    if (raw.length > 3000) throw Error();
    const parsed = z
      .object({
        action: z.enum(["confirm", "request"]),
        request: z.string().trim().max(1000).default(""),
      })
      .parse(JSON.parse(raw));
    if (parsed.action === "request" && !parsed.request) throw Error();
    const { data, error } = await db().rpc("dmcrm_public_appointment", {
      p_token: token,
      p_action: parsed.action,
      p_request: parsed.request,
    });
    if (error || !data)
      return NextResponse.json(
        { error: "This appointment link is unavailable." },
        { status: 404, headers },
      );
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json(
      { error: "Please check your request and try again." },
      { status: 400, headers },
    );
  }
}
