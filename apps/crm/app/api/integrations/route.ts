import { db, session } from "../../../lib/server";
import { canManage } from "../../../lib/model";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const s = await session();
    if (!s) return Response.json({error:"Sign in again."},{status:401});
    if (!canManage(s.role)) return Response.json({error:"Manager access required."},{status:403});
    const enabledOrg = s.org_id === "d5a1c100-0000-4000-8000-000000000001";
    const configured = enabledOrg && process.env.VERCEL_ENV === "production" && !!(
      process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_VERIFY_TOKEN && process.env.FACEBOOK_PAGE_ID);
    const latest = configured ? await db().from("dmcrm_facebook_messages").select("created_at")
      .eq("org_id",s.org_id).eq("page_id",process.env.FACEBOOK_PAGE_ID!).order("created_at",{ascending:false}).limit(1).maybeSingle() : null;
    if (latest?.error) throw Error("Status unavailable");
    return Response.json({facebook:{configured,last_received_at:latest?.data?.created_at ?? null},
      sms:{provider:"Telnyx",connected:false}}, {headers:{"Cache-Control":"private, no-store"}});
  } catch { return Response.json({error:"Connection status is temporarily unavailable."},{status:503}); }
}
