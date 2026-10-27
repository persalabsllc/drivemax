"use client";
import { useState } from "react";
import { type Workspace, type Command, myStaffId } from "../lib/model";
import { profileNameSchema } from "../lib/team";
import { SectionTitle } from "./ui";
export function UserProfileSettings(props: {
  ws: Workspace;
  busy: boolean;
  run: (c: Command, message?: string) => Promise<{ ok: boolean }>;
}) {
  return <ProfileNameForm key={props.ws.member.name} {...props} />;
}
function ProfileNameForm({
  ws,
  busy,
  run,
}: {
  ws: Workspace;
  busy: boolean;
  run: (c: Command, message?: string) => Promise<{ ok: boolean }>;
}) {
  const me = ws.staff.find((s) => s.id === myStaffId(ws)),
    parts = ws.member.name.trim().split(/\s+/);
  const [first, setFirst] = useState(me?.first_name || parts[0] || ""),
    [last, setLast] = useState(me?.last_name || parts.slice(1).join(" ")),
    [error, setError] = useState("");
  return (
    <section className="panel profile-settings">
      <SectionTitle
        title="Your profile"
        subtitle="Use your first and last name. Your full name appears throughout the CRM and on new activity."
      />
      <form
        className="profile-name-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const result = profileNameSchema.safeParse({
            first_name: first,
            last_name: last,
          });
          if (!result.success) {
            setError(result.error.issues[0].message);
            return;
          }
          const saved = await run(
            { type: "save_profile_name", profile: result.data },
            "Full name updated throughout your CRM account",
          );
          if (!saved.ok)
            setError("Your name could not be saved. Please try again.");
        }}
      >
        <label>
          First name
          <input
            autoComplete="given-name"
            required
            maxLength={60}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </label>
        <label>
          Last name
          <input
            autoComplete="family-name"
            required
            maxLength={60}
            value={last}
            onChange={(e) => setLast(e.target.value)}
          />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save full name"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
