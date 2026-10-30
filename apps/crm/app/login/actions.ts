"use server";
import { redirect } from "next/navigation";
import { auth, ready, session } from "../../lib/server";
import { clearSessionCookies, startIdleSession } from "../../lib/idle-server";
export async function signIn(_: { error: string }, form: FormData) {
  if (!ready())
    return {
      error:
        "Sign-in is temporarily unavailable. Please try again or contact your manager.",
    };
  const email = String(form.get("email") || "").trim(),
    password = String(form.get("password") || "");
  if (!email || !password)
    return { error: "Enter your email address and password." };
  try {
    const a = await auth();
    const { data, error } = await a.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user)
      return { error: "Unable to sign in. Check your email and password." };
    await startIdleSession(data.user.id);
    if (!(await session())) {
      await a.auth.signOut({ scope: "local" });
      await clearSessionCookies();
      return { error: "This account does not have CRM access yet." };
    }
  } catch {
    await clearSessionCookies();
    return { error: "Sign-in is temporarily unavailable. Please try again." };
  }
  redirect("/");
}
export async function signOut() {
  try {
    if (ready()) await (await auth()).auth.signOut({ scope: "local" });
  } catch {
    /* Always remove local credentials, including during an outage. */
  } finally {
    await clearSessionCookies();
  }
  redirect("/login");
}
