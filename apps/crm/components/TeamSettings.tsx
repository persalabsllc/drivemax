"use client";
import { useState } from "react";
import { Users, Plus, Copy } from "lucide-react";
import {
  type Workspace,
  type Staff,
  type Command,
  canManage,
} from "../lib/model";
import { Modal } from "./ui";
export function TeamSettings({
  ws,
  busy,
  error,
  demo,
  run,
}: {
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
    [linkBusy, setLinkBusy] = useState<string | null>(null);
  const manager = canManage(ws.member.role),
    owner = ws.member.role === "owner";
  const canEdit = (m: Staff) =>
    manager &&
    m.role !== "owner" &&
    m.user_id !== ws.member.id &&
    (owner || m.role === "sales");
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
            onClick={() => setEditing("new")}
          >
            <Plus size={14} />
            Add team member
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
                        onClick={() => setEditing(m)}
                      >
                        Edit
                      </button>
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
          Add a team member, then create a private setup link so they can choose
          their password. Share the link directly; no invitation email is sent
          automatically.
        </p>
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Add team member" : "Edit team member"}
          subtitle="Name, login email, and CRM role."
          onClose={() => setEditing(null)}
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
                      type: "save_staff",
                      ...(editing !== "new" ? { id: editing.id } : {}),
                      staff: {
                        name: String(f.get("name")),
                        email: String(f.get("email")),
                        role: String(f.get("role")) as "sales" | "manager",
                      },
                    },
                    "Team member saved",
                  )
                ).ok
              )
                setEditing(null);
            }}
          >
            <label>
              Name
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                defaultValue={editing === "new" ? "" : editing.name}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={250}
                readOnly={editing !== "new" && !!editing.user_id}
                defaultValue={editing === "new" ? "" : editing.email}
              />
            </label>
            <label>
              Role
              <select
                name="role"
                defaultValue={editing === "new" ? "sales" : editing.role}
              >
                <option value="sales">Salesperson · own tasks</option>
                {owner && <option value="manager">Manager · all tasks</option>}
              </select>
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-footer">
              <span>Owner access stays protected.</span>
              <button className="btn primary" disabled={busy}>
                Save team member
              </button>
            </div>
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
