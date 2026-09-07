import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Vehicle } from "./inventory";
import { leadEmailFrom, leadReplyDomain } from "./email-config";

export const backendReady = () =>
  process.env.CONTROL_ROOM_ENABLED === "true" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export const emailReady = () =>
  !!process.env.RESEND_API_KEY &&
  !!leadEmailFrom() &&
  !!leadReplyDomain() &&
  !!process.env.RESEND_WEBHOOK_SECRET;
export function db() {
  if (!backendReady()) throw new Error("Control Room is not connected yet.");
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
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
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
            /* Proxy refreshes cookies during page rendering. */
          }
        },
      },
    },
  );
}
export async function staffSession() {
  if (!backendReady()) return null;
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  const { data: staff, error: staffError } = await db()
    .from("staff")
    .select("id,name,email,role")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (staffError) throw new Error("Could not check staff access.");
  return staff as {
    id: string;
    name: string;
    email: string;
    role: "owner" | "staff";
  } | null;
}
export async function requireStaff() {
  const staff = await staffSession();
  if (!staff) redirect("/control-room/login");
  return staff;
}
// Public pages only request published inventory, never CRM or draft data.
export const publicInventory = cache(
  async (statuses: string = "available,sold") => {
    if (!backendReady()) return [] as Vehicle[];
    const allowed = statuses
      .split(",")
      .filter((s) => ["available", "pending", "sold"].includes(s));
    const result: Vehicle[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await db()
        .from("vehicles")
        .select("*")
        .in("status", allowed)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + 999);
      if (error) throw new Error("Inventory is temporarily unavailable.");
      result.push(...(data as Vehicle[]));
      if (data.length < 1000) break;
    }
    return result;
  },
);
export const publicVehicle = cache(async (slug: string) => {
  if (!backendReady()) return null;
  const { data, error } = await db()
    .from("vehicles")
    .select("*")
    .eq("slug", slug)
    .in("status", ["available", "pending", "sold"])
    .maybeSingle();
  if (error) throw new Error("Inventory is temporarily unavailable.");
  return data as Vehicle | null;
});
export function photoUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/vehicle-photos/${path}`;
}
