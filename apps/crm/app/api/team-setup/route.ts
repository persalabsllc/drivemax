import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { auth, db } from "../../../lib/server";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const schema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(1).max(128).optional(),
  mode: z.enum(["new", "existing"]).optional(),
});
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  let created: string | undefined,
    claimed = false;
  try {
    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "Request too large." }, 413);
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Invalid setup link." }, 400);
    const p = parsed.data,
      hash = createHash("sha256").update(p.token).digest("hex"),
      admin = db();
    const { data: invite, error } = await admin
      .from("dmcrm_staff_invites")
      .select("org_id,staff_id,expires_at,consumed_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (
      error ||
      !invite ||
      invite.consumed_at ||
      new Date(invite.expires_at) <= new Date()
    )
      return json(
        {
          error:
            "This setup link expired or was already used. Ask your manager for a new link.",
        },
        410,
      );
    const { data: staff } = await admin
      .from("dmcrm_staff")
      .select("id,name,email,role,active,user_id")
      .eq("org_id", invite.org_id)
      .eq("id", invite.staff_id)
      .maybeSingle();
    if (!staff?.active || staff.user_id)
      return json({ error: "This setup link is no longer available." }, 410);
    if (!p.password)
      return json({ name: staff.name, email: staff.email, role: staff.role });
    if (p.mode !== "existing") {
      if (p.password.length < 12)
        return json(
          { error: "Choose a password with at least 12 characters." },
          400,
        );
      // Only a valid, manager-issued invitation can create an account. Existing accounts are never changed.
      const { data, error } = await admin.auth.admin.createUser({
        email: staff.email,
        password: p.password,
        email_confirm: true,
        app_metadata: { dmcrm_org_id: invite.org_id },
      });
      if (error || !data.user)
        return json(
          {
            error:
              "Could not create this account. If this email already has an account, choose Existing account and use its password.",
          },
          400,
        );
      created = data.user.id;
    }
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await client.auth.signInWithPassword({
      email: staff.email,
      password: p.password,
    });
    if (
      signed.error ||
      !signed.data.user ||
      !signed.data.session ||
      !signed.data.user.email_confirmed_at
    )
      return json(
        {
          error:
            "Unable to sign in. Check the password for this email address.",
        },
        400,
      );
    const result = await admin.rpc("dmcrm_claim_staff_invite", {
      p_hash: hash,
      p_user: signed.data.user.id,
      p_email: signed.data.user.email,
    });
    if (result.error)
      return json(
        {
          error:
            "The setup link is no longer available, or this account already belongs to this dealership.",
        },
        409,
      );
    claimed = true;
    const { error: cookieError } = await (
      await auth()
    ).auth.setSession(signed.data.session);
    return json({ ok: true, redirect: cookieError ? "/login" : "/" });
  } catch {
    return json(
      { error: "Setup could not be completed. Please try again." },
      503,
    );
  } finally {
    if (created && !claimed)
      await db()
        .auth.admin.deleteUser(created)
        .catch(() => {});
  }
}
