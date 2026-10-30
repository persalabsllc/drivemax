import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { IDLE_COOKIE, IDLE_TIMEOUT_MS, type IdleState } from "./idle-policy";
import { signIdleState, verifyIdleState } from "./idle-token";
export async function readIdleState() {
  return verifyIdleState(
    (await cookies()).get(IDLE_COOKIE)?.value,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
export async function writeIdleState(state: IdleState) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("CRM connection unavailable");
  (await cookies()).set(IDLE_COOKIE, signIdleState(state, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(state.lastActiveAt + IDLE_TIMEOUT_MS),
  });
}
export async function startIdleSession(userId: string) {
  await writeIdleState({ id: randomUUID(), userId, lastActiveAt: Date.now() });
}
export async function clearSessionCookies() {
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (
      name === IDLE_COOKIE ||
      name === "dmcrm-session" ||
      name.startsWith("dmcrm-session.")
    )
      jar.set(name, "", {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 0,
      });
  }
}
