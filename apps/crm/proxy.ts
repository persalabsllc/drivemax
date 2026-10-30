import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { IDLE_COOKIE } from "./lib/idle-policy";
import { verifyIdleState } from "./lib/idle-token";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !verifyIdleState(
      request.cookies.get(IDLE_COOKIE)?.value,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  )
    return response;
  const a = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        name: "dmcrm-session",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await a.auth.getUser();
  return response;
}
export const config = {
  matcher: [
    "/",
    "/login",
    "/api/workspace",
    "/api/attention",
    "/api/session",
    "/api/team/:path*",
  ],
};
