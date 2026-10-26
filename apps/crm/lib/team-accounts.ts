import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { teamAccountSchema } from "./team";

export class TeamAccountError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function manageTeamAccount(
  admin: SupabaseClient,
  actor: { org_id: string; user_id: string; role: string },
  input: z.infer<typeof teamAccountSchema>,
) {
  if (!["owner", "manager"].includes(actor.role))
    throw new TeamAccountError("Manager access required.", 403);
  const args = { p_org: actor.org_id, p_actor: actor.user_id };
  let email: string;
  let staffId: string | undefined;
  if (input.action === "create") {
    if (input.staff.role === "manager" && actor.role !== "owner")
      throw new TeamAccountError("Only the owner can add managers.", 403);
    email = input.staff.email;
    const existing = await admin
      .from("dmcrm_staff")
      .select("id")
      .eq("org_id", actor.org_id)
      .eq("email", email)
      .maybeSingle();
    if (existing.error)
      throw new TeamAccountError(
        "Could not check the team directory. Please try again.",
        503,
      );
    if (existing.data)
      throw new TeamAccountError(
        "That email is already on your team. Edit the existing user instead.",
        409,
      );
  } else {
    const target = await admin.rpc("dmcrm_staff_password_target", {
      ...args,
      p_staff: input.staff_id,
    });
    if (target.error || !target.data)
      throw new TeamAccountError(
        "Password changes are available only for active CRM logins you manage. Accounts linked from another application use their original password recovery.",
        403,
      );
    email = target.data.email;
    staffId = input.staff_id;
    if (target.data.user_id) {
      const result = await admin.auth.admin.updateUserById(
        target.data.user_id,
        { password: input.password },
      );
      if (result.error)
        throw new TeamAccountError(
          "The password could not be changed. Try a different password or retry.",
        );
      // Never log a password or an authentication response.
      const audit = await admin
        .from("dmcrm_audit")
        .insert({
          org_id: actor.org_id,
          actor: actor.user_id,
          action: "reset_staff_password",
          record_id: staffId,
        });
      return {
        id: staffId,
        message: audit.error
          ? "Password changed. The audit entry could not be recorded; contact the owner."
          : "Password changed. Share it privately with the team member.",
      };
    }
  }
  const created = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    app_metadata: { dmcrm_org_id: actor.org_id },
  });
  if (created.error || !created.data.user)
    throw new TeamAccountError(
      "Could not create the login. If this email already has an account, choose a private setup link and sign in with that existing account.",
      409,
    );
  const userId = created.data.user.id;
  let linked = false;
  try {
    const result =
      input.action === "create"
        ? await admin.rpc("dmcrm_create_staff_account", {
            ...args,
            p_staff: input.staff,
            p_user: userId,
          })
        : await admin.rpc("dmcrm_link_staff_account", {
            ...args,
            p_staff: staffId,
            p_user: userId,
          });
    if (result.error)
      throw new TeamAccountError(
        "The login could not be linked. Refresh the team list and try again.",
        409,
      );
    linked = true;
    return {
      id: result.data as string,
      message:
        "User login created. They can sign in with the email and password you entered.",
    };
  } finally {
    if (!linked) {
      // A network failure can arrive after a committed link. Delete only a positively unlinked, newly created identity.
      const check = await admin
        .from("dmcrm_staff")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      if (!check.error && check.data?.length === 0)
        await admin.auth.admin.deleteUser(userId);
    }
  }
}
