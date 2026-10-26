import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Workspace } from "./model";
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
  return data;
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
  ] as const;
  // Pages are fetched fully in batches; never silently truncate the customer book.
  async function all(table: string) {
    const rows: unknown[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await d
        .from("dmcrm_" + table)
        .select("*")
        .eq("org_id", s.org_id)
        .order("id")
        .range(start, start + 999);
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
  const rows = await Promise.all(tables.map(all));
  return {
    org,
    member: { id: s.user_id, name: s.name, role: s.role },
    ...Object.fromEntries(tables.map((t, i) => [t, rows[i]])),
  } as Workspace;
}
