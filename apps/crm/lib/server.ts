import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { canManage, type Workspace } from "./model";
import { emailConnection } from "./messaging";
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
  const a = await auth();
  const {
    data: { user },
    error,
  } = await a.auth.getUser();
  if (error || !user?.email_confirmed_at) return null;
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
    .select("id")
    .eq("org_id", data.org_id)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (staffError) throw new Error("CRM team unavailable");
  return staff ? { ...data, staff_id: staff.id } : null;
}
export async function workspace(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
): Promise<Workspace> {
  const d = db();
  const tables = [
    "customers",
    "visits",
    "activities",
    "tasks",
    "quotes",
    "inventory",
    "opportunities",
    "staff",
    "sales",
    "trades",
    "commissions",
    "messages",
    "appointments",
    "email_templates",
    "workflow_rules",
    "workflow_jobs",
    "workflow_pauses",
    "deal_progress",
    "buyer_preferences",
    "inventory_prep",
    "sales_events",
    "deal_files",
  ] as const;
  // Pages are fetched fully in batches; never silently truncate the customer book.
  async function all(table: string) {
    if (table === "trades" && !canManage(s.role)) return [];
    const rows: unknown[] = [];
    for (let start = 0; ; start += 1000) {
      let query = d
        .from("dmcrm_" + table)
        .select(
          table === "sales" && !canManage(s.role)
            ? "id,org_id,opportunity_id,customer_id,sold_on,status,unwound_at,unwind_reason"
            : table === "staff" && !canManage(s.role)
              ? "id,org_id,user_id,name,email,role,active,created_at"
              : table === "deal_files"
                ? "id,org_id,customer_id,opportunity_id,name,kind,size,created_at,created_by"
                : table === "workflow_jobs"
                  ? "id,org_id,rule_id,customer_id,opportunity_id,appointment_id,event,run_at,state,reason,message_id,task_id,created_at"
                  : "*",
        )
        .eq("org_id", s.org_id);
      if (table === "inventory" || table === "trades")
        query = query.is("deleted_at", null);
      // Never deliver another salesperson's tasks to the browser, exports, or planner.
      if (table === "tasks" && !canManage(s.role))
        query = query.eq("assigned_to", s.staff_id);
      if (table === "commissions" && !canManage(s.role))
        query = query.eq("staff_id", s.staff_id);
      const { data, error } = await query.order("id").range(start, start + 999);
      if (error) throw new Error("CRM records unavailable");
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }
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
  const [rows, websiteInventory, emailSettings, emailSignature, connection] =
    await Promise.all([
      Promise.all(tables.map(all)),
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
  const records = Object.fromEntries(
    tables.map((t, i) => [t, rows[i]]),
  ) as unknown as Pick<Workspace, (typeof tables)[number]>;
  if (!canManage(s.role)) {
    const assigned = new Set(
      records.opportunities
        .filter((o) => o.assigned_to === s.staff_id)
        .map((o) => o.id),
    );
    records.deal_files = records.deal_files?.filter(
      (f) => !!f.opportunity_id && assigned.has(f.opportunity_id),
    );
  }
  return {
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
    member: { id: s.user_id, name: s.name, role: s.role, staff_id: s.staff_id },
    ...records,
  } as Workspace;
}

export async function attention(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
) {
  const { data, error } = await db().rpc("dmcrm_attention", {
    p_org: s.org_id,
    p_actor: s.user_id,
  });
  if (error) throw new Error("Attention feed unavailable");
  return data as import("./attention").AttentionFeed;
}
