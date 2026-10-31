import { restrictWorkspace } from "./workspace-permissions";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type Workspace } from "./model";
import { emailConnection } from "./messaging";
import { readWorkspaceRecords } from "./workspace-records";
import { readIdleState } from "./idle-server";
export const ready = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
export function db() {
  if (!ready()) throw new Error("CRM connection unavailable");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    },
  );
}
export async function auth() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        name: "dmcrm-session",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* refreshed by proxy */
          }
        },
      },
    },
  );
}
export async function session() {
  if (!ready()) return null;
  // Staff API requests and background polling never renew inactivity.
  const idle = await readIdleState();
  if (!idle) return null;
  const a = await auth();
  const {
    data: { user },
    error,
  } = await a.auth.getUser();
  if (error || !user?.email_confirmed_at || idle.userId !== user.id)
    return null;
  const { data, error: e } = await db()
    .from("dmcrm_members")
    .select("org_id,user_id,name,role")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("org_id")
    .limit(1)
    .maybeSingle();
  if (e) throw new Error("CRM membership unavailable");
  if (!data) return null;
  const { data: staff, error: staffError } = await db()
    .from("dmcrm_staff")
    .select("id,name,role")
    .eq("org_id", data.org_id)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (staffError) throw new Error("CRM team unavailable");
  return staff && staff.role === data.role
    ? { ...data, name: staff.name, staff_id: staff.id }
    : null;
}
export async function workspace(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
): Promise<Workspace> {
  const d = db();
  const { data: org, error } = await d
    .from("dmcrm_orgs")
    .select("id,name,slug")
    .eq("id", s.org_id)
    .single();
  if (error) throw new Error("Dealership unavailable");
  // Attention can recover pending website inquiries. Finish those writes before
  // reading the customer book so alerts and profiles arrive in the same response.
  const alerts = await attention(s);
  const workflowHealth = await d
    .from("dmcrm_workflow_health")
    .select("last_background_at")
    .eq("org_id", s.org_id)
    .maybeSingle();
  const [records, websiteInventory, emailSettings, emailSignature, connection] =
    await Promise.all([
      readWorkspaceRecords(d, s),
      d.rpc("dmcrm_inventory_website_state", {
        p_org: s.org_id,
        p_actor: s.user_id,
      }),
      d
        .from("dmcrm_email_settings")
        .select("*")
        .eq("org_id", s.org_id)
        .maybeSingle(),
      d
        .from("dmcrm_email_signatures")
        .select("*")
        .eq("org_id", s.org_id)
        .eq("user_id", s.user_id)
        .maybeSingle(),
      emailConnection(s.org_id),
    ]);
  if (websiteInventory.error)
    throw new Error("Website inventory status unavailable");
  if (emailSettings.error || emailSignature.error)
    throw new Error("Email settings unavailable");
  return restrictWorkspace({
    org,
    attention: alerts,
    website_inventory: websiteInventory.data,
    email_settings: emailSettings.data ?? undefined,
    email_signature: emailSignature.data,
    email_connection: connection,
    workflow_health: {
      last_run_at: workflowHealth.data?.last_background_at ?? null,
      scheduled: 0,
      failed: 0,
    },
    member: {
      id: s.user_id,
      name: records.staff.find((m) => m.id === s.staff_id)?.name ?? s.name,
      role: s.role,
      staff_id: s.staff_id,
    },
    ...records,
  } as Workspace);
}

export async function attention(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
) {
  const [{data,error}, chats] = await Promise.all([
    db().rpc("dmcrm_attention", {p_org:s.org_id,p_actor:s.user_id}),
    db().rpc("dmcrm_chat_staff", {p_org:s.org_id,p_actor:s.user_id,p_action:"alerts",p_data:{}}),
  ]);
  if (error) throw new Error("Attention feed unavailable");
  const feed = data as import("./attention").AttentionFeed;
  const items = chats.error ? [] : chats.data as import("./attention").AttentionItem[];
  return {...feed, items:[...items,...feed.items], total:feed.total+items.length};
}
