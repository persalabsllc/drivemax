import { NextResponse } from "next/server";
import { db, session } from "../../../lib/server";
import { canManage } from "../../../lib/permissions";
import { activityQuerySchema } from "../../../lib/website-activity";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to view website activity." }, 401);
    const parsed = activityQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return json({ error: "Choose valid dates within a 180-day range." }, 400);
    const q = parsed.data;
    if (!q.customer && !canManage(s.role))
      return json({ error: "Website reports are available to managers." }, 403);
    const { data, error } = await db().rpc("dmcrm_web_read", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_from: q.from,
      p_to: q.to,
      p_session: q.session || null,
      p_customer: q.customer || null,
      p_offset: q.offset,
      p_source: q.source,
      p_vehicle: q.vehicle || null,
    });
    if (error) {
      if (error.code === "42501")
        return json(
          {
            error:
              "You do not have access to this customer’s website activity.",
          },
          403,
        );
      throw error;
    }
    return json(data);
  } catch {
    return json(
      { error: "Website activity could not be loaded. Please try again." },
      503,
    );
  }
}
