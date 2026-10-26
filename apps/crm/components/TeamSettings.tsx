"use client";
import { useId, useState } from "react";
import { Users, Plus, Copy, KeyRound, Eye, EyeOff } from "lucide-react";
import {
  type Workspace,
  type Staff,
  type Command,
  canManage,
} from "../lib/model";
import { Modal } from "./ui";
import { staffSchema, staffPasswordSchema, mayManageStaff } from "../lib/team";
export function TeamSettings({
  ws,
  busy,
  error,
  demo,
  run,
  onAccountChanged,
}: {
  onAccountChanged: () => Promise<void>;
  ws: Workspace;
  busy: boolean;
  error: string;
  demo: boolean;
  run: (p: Command, message?: string) => Promise<{ ok: boolean }>;
}) {
  const [editing, setEditing] = useState<Staff | "new" | null>(null),
    [deactivate, setDeactivate] = useState<Staff | null>(null),
    [link, setLink] = useState<{ name: string; url: string } | null>(null),
    [notice, setNotice] = useState(""),
    [linkBusy, setLinkBusy] = useState<string | null>(null),
    [passwordTarget, setPasswordTarget] = useState<Staff | null>(null),
    [accountBusy, setAccountBusy] = useState(false),
    [accountError, setAccountError] = useState("");
  const manager = canManage(ws.member.role),
    owner = ws.member.role === "owner";
  const canEdit = (m: Staff) =>
    mayManageStaff({ role: ws.member.role, user_id: ws.member.id }, m);
  async function account(input: unknown) {
    setAccountBusy(true);
    setAccountError("");
    try {
      if (demo) {
        setNotice("Demo only. No real login or password was changed.");
        return true;
      }
      const r = await fetch("/api/team/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setNotice(data.message);
      await onAccountChanged();
      return true;
    } catch (e) {
      setAccountError(
        e instanceof Error ? e.message : "Could not update the account.",
      );
      return false;
    } finally {
      setAccountBusy(false);
    }
  }
  async function setup(m: Staff) {
    setNotice("");
    if (demo) {
      setNotice(
        "Setup links are available in your live workspace. Demo staff changes stay in this tab.",
      );
      return;
    }
    setLinkBusy(m.id);
    try {
      const r = await fetch("/api/team/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: m.id }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setLink({ name: m.name, url: data.url });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not prepare setup.");
    } finally {
      setLinkBusy(null);
    }
  }
  return (
    <section className="panel team-settings">
      <div className="section-heading">
        <div>
          <h2>
            <Users size={18} /> Your team
          </h2>
          <p>Assign opportunities and give everyone a clear follow-up list.</p>
        </div>
        {manager && (
          <button
            className="btn primary small"
            onClick={() => {
              setAccountError("");
              setEditing("new");
            }}
          >
            <Plus size={14} />
            Add user
          </button>
        )}
      </div>
      <p className="team-access-note">
        Owners and managers can see all tasks. Salespeople see only their
        assigned tasks. Customer profiles remain shared across the dealership.
      </p>
      {notice && (
        <p className="history-notice" role="status">
          {notice}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name / email</th>
              {manager && <th>Phone</th>}
              <th>Role</th>
              <th>Access</th>
              {manager && <th>Open tasks</th>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ws.staff.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                  <span className="subtext">{m.email || "Owner account"}</span>
                </td>
                {manager && <td>{m.phone || "Not recorded"}</td>}
                <td>
                  {m.role === "sales"
                    ? "Salesperson"
                    : m.role === "manager"
                      ? "Manager"
                      : "Owner"}
                </td>
                <td>
                  <span
                    className={`badge ${m.active ? "badge-live" : "badge-left"}`}
                  >
                    {!m.active
                      ? "Inactive"
                      : m.user_id
                        ? "Connected"
                        : "Needs setup"}
                  </span>
                </td>
                {manager && (
                  <td>
                    {
                      ws.tasks.filter(
                        (t) =>
                          t.assigned_to === m.id &&
                          !t.completed_at &&
                          !t.canceled_at,
                      ).length
                    }
                  </td>
                )}
                <td>
                  {canEdit(m) && (
                    <div className="team-row-actions">
                      <button
                        className="btn small"
                        onClick={() => {
                          setAccountError("");
                          setEditing(m);
                        }}
                      >
                        Edit
                      </button>
                      {m.active && (!m.user_id || m.password_managed) && (
                        <button
                          className="btn small"
                          disabled={busy || accountBusy}
                          onClick={() => {
                            setAccountError("");
                            setPasswordTarget(m);
                          }}
                        >
                          <KeyRound size={13} />{" "}
                          {m.user_id ? "Reset password" : "Set password"}
                        </button>
                      )}
                      {m.active && !m.user_id && (
                        <button
                          className="btn small"
                          disabled={busy || !!linkBusy}
                          onClick={() => setup(m)}
                        >
                          {linkBusy === m.id
                            ? "Preparing…"
                            : "Create setup link"}
                        </button>
                      )}
                      {m.active ? (
                        <button
                          className="text-btn muted"
                          onClick={() => setDeactivate(m)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            run(
                              {
                                type: "set_staff_active",
                                id: m.id,
                                active: true,
                              },
                              "Team member reactivated",
                            )
                          }
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manager && (
        <p className="fine-print">
          Create a login with an initial password, or share a private setup
          link. Phone and address details are visible to managers only.
          Notification delivery will be connected in a future update.
        </p>
      )}
      <div className="team-commission-defaults">
        <strong>Commission defaults</strong>
        <span>
          25% of front gross, excluding doc fee and pack · 5% of F&I gross
        </span>
        <p>
          New sold deals assign both to the salesperson. Edit recipients or use
          a manual amount in the deal recap. Missing costs stay pending;
          recorded commissions keep their amounts.
        </p>
      </div>
      {editing && (
        <Modal
          title={editing === "new" ? "Add user" : "Edit user"}
          subtitle="Staff contact information and dealership access."
          onClose={() => {
            if (!accountBusy && !busy) setEditing(null);
          }}
        >
          <TeamMemberForm
            key={editing === "new" ? "new" : editing.id}
            member={editing}
            owner={owner}
            busy={busy || accountBusy}
            error={accountError || error}
            onSave={async (staff, password) => {
              if (editing === "new" && password && !demo) {
                if (await account({ action: "create", staff, password }))
                  setEditing(null);
              } else {
                const result = await run(
                  {
                    type: "save_staff",
                    ...(editing !== "new" ? { id: editing.id } : {}),
                    staff,
                  },
                  "Team member saved",
                );
                if (result.ok) {
                  setEditing(null);
                  setNotice(
                    demo
                      ? "Demo user saved. No real login was created."
                      : editing === "new"
                        ? "Team member saved. Use Set password or Create setup link to activate their login."
                        : "Staff contact details updated.",
                  );
                }
              }
            }}
          />
        </Modal>
      )}
      {passwordTarget && (
        <Modal
          title={`${passwordTarget.user_id ? "Reset" : "Set"} password for ${passwordTarget.name}`}
          subtitle={passwordTarget.email}
          onClose={() => {
            if (!accountBusy) setPasswordTarget(null);
          }}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              const parsed = staffPasswordSchema.safeParse(password);
              if (!parsed.success) {
                setAccountError(parsed.error.issues[0].message);
                return;
              }
              if (password !== f.get("confirm_password")) {
                setAccountError("Passwords must match.");
                return;
              }
              if (
                await account({
                  action: "set_password",
                  staff_id: passwordTarget.id,
                  password,
                })
              )
                setPasswordTarget(null);
            }}
          >
            <p className="fine-print">
              The new password takes effect immediately. Share it privately with
              this team member. No email or text will be sent.
            </p>
            <PasswordFields />
            {accountError && (
              <p className="form-error" role="alert">
                {accountError}
              </p>
            )}
            <button className="btn primary" disabled={accountBusy}>
              {accountBusy
                ? "Updating…"
                : passwordTarget.user_id
                  ? "Reset password"
                  : "Create login"}
            </button>
          </form>
        </Modal>
      )}
      {deactivate && (
        <Modal
          title={`Deactivate ${deactivate.name}?`}
          subtitle="Their CRM access ends and unfinished work is handed over."
          onClose={() => setDeactivate(null)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                (
                  await run(
                    {
                      type: "set_staff_active",
                      id: deactivate.id,
                      active: false,
                      reassign_to: String(f.get("replacement")),
                    },
                    "Access removed and unfinished work reassigned",
                  )
                ).ok
              )
                setDeactivate(null);
            }}
          >
            <label>
              Assign their opportunities and unfinished tasks to
              <select name="replacement" required defaultValue="">
                <option value="" disabled>
                  Choose a team member
                </option>
                {ws.staff
                  .filter((m) => m.active && m.id !== deactivate.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="fine-print">
              Completed task history stays attached to the original salesperson.
            </p>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              Deactivate and transfer work
            </button>
          </form>
        </Modal>
      )}
      {link && (
        <Modal
          title={`Set up ${link.name}`}
          subtitle="One use · Expires in 72 hours"
          onClose={() => setLink(null)}
        >
          <div className="modal-form">
            <p>
              Share this private link directly with {link.name}. They can create
              a password or sign in with an existing account for their email
              address.
            </p>
            <label>
              Private setup link
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="modal-footer">
              <span>Creating another link replaces this one.</span>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setNotice("Setup link copied.");
                  } catch {
                    setNotice("Select and copy the link above.");
                  }
                }}
              >
                <Copy size={14} />
                Copy link
              </button>
            </div>
            {notice && <p role="status">{notice}</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}

function PasswordFields() {
  const [show, setShow] = useState(false);
  const hint = useId();
  const passwordId = useId();
  return (
    <div className="team-password-fields">
      <div>
        <label htmlFor={passwordId}>New password</label>
        <div className="login-password">
          <input
            id={passwordId}
            name="password"
            type={show ? "text" : "password"}
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            aria-describedby={hint}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      <label>
        Confirm password
        <input
          name="confirm_password"
          type={show ? "text" : "password"}
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <p className="fine-print" id={hint}>
        At least 12 characters. Passwords cannot be viewed after saving.
      </p>
    </div>
  );
}

function TeamMemberForm({
  member,
  owner,
  busy,
  error,
  onSave,
}: {
  member: Staff | "new";
  owner: boolean;
  busy: boolean;
  error: string;
  onSave: (
    staff: ReturnType<typeof staffSchema.parse>,
    password?: string,
  ) => Promise<void>;
}) {
  const [loginMode, setLoginMode] = useState("password"),
    [validation, setValidation] = useState("");
  const m = member === "new" ? null : member;
  const fields = [
    [
      "first_name",
      "First name",
      m?.first_name ?? m?.name.split(" ")[0] ?? "",
      60,
      "given-name",
    ],
    [
      "last_name",
      "Last name",
      m?.last_name ?? m?.name.split(" ").slice(1).join(" ") ?? "",
      60,
      "family-name",
    ],
    ["address1", "Street address", m?.address1 ?? "", 250, "address-line1"],
    [
      "address2",
      "Apartment / suite (optional)",
      m?.address2 ?? "",
      250,
      "address-line2",
    ],
    ["city", "City", m?.city ?? "", 100, "address-level2"],
    ["state", "State", m?.state || "NC", 2, "address-level1"],
    ["zip", "ZIP code", m?.zip ?? "", 10, "postal-code"],
  ] as const;
  return (
    <form
      className="modal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setValidation("");
        const f = new FormData(e.currentTarget);
        const parsed = staffSchema.safeParse(Object.fromEntries(f));
        if (!parsed.success) {
          setValidation(parsed.error.issues[0].message);
          return;
        }
        const password =
          !m && loginMode === "password"
            ? String(f.get("password"))
            : undefined;
        if (password && password !== f.get("confirm_password")) {
          setValidation("Passwords must match.");
          return;
        }
        await onSave(parsed.data, password);
      }}
    >
      <div className="ops-form-grid team-contact-grid">
        {fields.slice(0, 2).map(([name, label, value, max, autocomplete]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              required
              maxLength={max}
              defaultValue={value}
              autoComplete={autocomplete}
            />
          </label>
        ))}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={250}
            readOnly={!!m?.user_id}
            defaultValue={m?.email ?? ""}
            autoComplete="email"
          />
        </label>
        <label>
          Phone number
          <input
            name="phone"
            type="tel"
            required
            maxLength={30}
            defaultValue={m?.phone ?? ""}
            autoComplete="tel"
            placeholder="(252) 555-0123"
          />
        </label>
        {fields.slice(2).map(([name, label, value, max, autocomplete]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              required={name !== "address2"}
              maxLength={max}
              defaultValue={value}
              autoComplete={autocomplete}
            />
          </label>
        ))}
        <label>
          Role
          <select name="role" defaultValue={m?.role ?? "sales"}>
            <option value="sales">Salesperson · own tasks</option>
            {owner && <option value="manager">Manager · all tasks</option>}
          </select>
        </label>
      </div>
      {!m && (
        <>
          <label>
            Login setup
            <select
              value={loginMode}
              onChange={(e) => setLoginMode(e.target.value)}
            >
              <option value="password">Set initial password now</option>
              <option value="link">
                Let user choose through a private setup link
              </option>
            </select>
          </label>
          {loginMode === "password" && <PasswordFields />}
        </>
      )}
      {(validation || error) && (
        <p className="form-error" role="alert">
          {validation || error}
        </p>
      )}
      <div className="modal-footer">
        <span>Staff contact details stay private to managers.</span>
        <button className="btn primary" disabled={busy}>
          {busy
            ? "Saving…"
            : !m && loginMode === "password"
              ? "Create user & login"
              : "Save user"}
        </button>
      </div>
    </form>
  );
}
