"use client";
import { useState } from "react";
import { Mail, Plus, Pencil, Trash2, PenLine, Zap } from "lucide-react";
import { canManage, type Workspace, type Command } from "../lib/model";
import {
  emailCategories,
  emailTokens,
  emailTemplateSchema,
  personalSignature,
  renderEmailTemplate,
  appendSignature,
  type EmailTemplate,
} from "../lib/email";
import { Modal } from "./ui";
type Run = (command: Command, message?: string) => Promise<{ ok: boolean }>;

export function EmailSettingsPanel({
  ws,
  busy,
  run,
  error,
  demo,
}: {
  ws: Workspace;
  busy: boolean;
  run: Run;
  error: string;
  demo: boolean;
}) {
  const [editing, setEditing] = useState<EmailTemplate | "new" | null>(null),
    [deleting, setDeleting] = useState<EmailTemplate | null>(null),
    [search, setSearch] = useState("");
  const manager = canManage(ws.member.role),
    templates = [...(ws.email_templates ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  return (
    <section className="panel email-settings">
      <div className="section-heading">
        <div>
          <h2>
            <Mail size={19} /> Email & follow-up
          </h2>
          <p>
            Personal messages, reusable templates, and a timely welcome for
            every new inquiry.
          </p>
        </div>
        <span
          className={`badge ${ws.email_connection?.connected ? "badge-live" : "badge-left"}`}
        >
          {demo
            ? "Demo · no sending"
            : ws.email_connection?.connected
              ? "Email connected"
              : "Email unavailable"}
        </span>
      </div>
      <p className="email-connection-copy">
        From {ws.email_connection?.sender || "sales@drivemaxusedcars.com"}.
        Replies to CRM emails return to the customer profile and Needs
        attention. SMS is not connected.
      </p>
      {ws.email_connection?.reason && (
        <p className="ops-help">{ws.email_connection.reason}</p>
      )}
      <div className="email-settings-grid">
        <SignatureEditor
          key={`${ws.member.id}:${ws.email_signature?.revision ?? -1}`}
          ws={ws}
          busy={busy}
          run={run}
        />
        <WorkflowEditor
          key={ws.email_settings?.revision ?? 0}
          ws={ws}
          busy={busy}
          run={run}
          manager={manager}
          demo={demo}
        />
      </div>
      <div className="section-heading email-template-heading">
        <div>
          <h3>
            Email templates{" "}
            <span className="ops-count">{templates.length}</span>
          </h3>
          <p>
            Select a template when composing an email inside a customer profile.
            Follow-up templates send only when you click Send email.
          </p>
        </div>
        {manager && (
          <button
            className="btn primary small"
            onClick={() => setEditing("new")}
          >
            <Plus size={15} /> Add template
          </button>
        )}
      </div>
      <label className="email-template-search">
        Find a template
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="New lead, birthday, sold…"
        />
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Subject</th>
              <th>Category</th>
              <th>{manager ? "Manage" : "Preview"}</th>
            </tr>
          </thead>
          <tbody>
            {templates
              .filter((t) =>
                `${t.name} ${t.category} ${t.subject}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {ws.email_settings?.auto_reply_enabled &&
                      t.id === ws.email_settings.auto_reply_template_id && (
                        <small className="subtext email-workflow-label">
                          Used for automatic first response
                        </small>
                      )}
                  </td>
                  <td>{t.subject}</td>
                  <td>{t.category}</td>
                  <td>
                    <div className="ops-actions">
                      <button
                        className="btn small"
                        onClick={() => setEditing(t)}
                      >
                        <Pencil size={13} /> {manager ? "Edit" : "View"}
                      </button>
                      {manager && (
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${t.name}`}
                          onClick={() => setDeleting(t)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <TemplateEditor
          key={editing === "new" ? "new" : editing.id}
          existing={editing === "new" ? undefined : editing}
          ws={ws}
          busy={busy}
          run={run}
          error={error}
          editable={manager}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Modal
          title="Delete email template"
          subtitle={deleting.name}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-form">
            <p>
              Delete this template? Emails and drafts already created from it
              will stay in customer history.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="ops-actions">
              <button className="btn" onClick={() => setDeleting(null)}>
                Keep template
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    (
                      await run(
                        {
                          type: "delete_email_template",
                          id: deleting.id,
                          revision: deleting.revision,
                        },
                        "Email template deleted",
                      )
                    ).ok
                  )
                    setDeleting(null);
                }}
              >
                Delete template
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
function SignatureEditor({
  ws,
  busy,
  run,
}: {
  ws: Workspace;
  busy: boolean;
  run: Run;
}) {
  const [body, setBody] = useState(personalSignature(ws));
  return (
    <form
      className="email-settings-card"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(
          {
            type: "save_email_signature",
            body,
            revision: ws.email_signature?.revision ?? 0,
          },
          "Your email signature saved",
        );
      }}
    >
      <h3>
        <PenLine size={17} /> Your email signature
      </h3>
      <p>
        {ws.member.name} · applies to new emails you compose. Other users manage
        their own signatures.
      </p>
      <label>
        Signature
        <textarea
          aria-label="Signature"
          rows={5}
          maxLength={3000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Name, title, phone, website…"
        />
      </label>
      <small>
        Plain text keeps signatures readable on every device. Leave blank to
        omit a signature. Existing drafts keep their original text.
      </small>
      <button className="btn small" disabled={busy}>
        Save my signature
      </button>
    </form>
  );
}
function WorkflowEditor({
  ws,
  busy,
  run,
  manager,
  demo,
}: {
  ws: Workspace;
  busy: boolean;
  run: Run;
  manager: boolean;
  demo: boolean;
}) {
  const cfg = ws.email_settings;
  const [enabled, setEnabled] = useState(cfg?.auto_reply_enabled ?? false),
    [template, setTemplate] = useState(cfg?.auto_reply_template_id ?? ""),
    [signature, setSignature] = useState(cfg?.auto_reply_signature ?? "");
  return (
    <form
      className="email-settings-card"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(
          {
            type: "save_email_settings",
            enabled,
            template_id: template || null,
            signature,
            revision: cfg?.revision ?? 0,
          },
          "Automatic first response updated",
        );
      }}
    >
      <h3>
        <Zap size={17} /> Website lead first response
      </h3>
      <p>
        After a new website inquiry reaches the CRM, send one thank-you email.
        Applies to contact, test-drive, vehicle and sell-your-car inquiries with
        an email address.
      </p>
      <label className="email-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!manager}
          onChange={(e) => setEnabled(e.target.checked)}
        />{" "}
        Send an automatic first response{demo ? " (demo)" : ""}
      </label>
      <label>
        Response template
        <select
          aria-label="Response template"
          value={template}
          required={enabled}
          disabled={!manager}
          onChange={(e) => setTemplate(e.target.value)}
        >
          <option value="">Select a template</option>
          {(ws.email_templates ?? []).map((t) => (
            <option value={t.id} key={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Team signature for automatic replies
        <textarea
          aria-label="Team signature for automatic replies"
          rows={3}
          maxLength={3000}
          value={signature}
          disabled={!manager}
          onChange={(e) => setSignature(e.target.value)}
        />
      </label>
      <small>
        Applies to future inquiries. Existing leads and saved drafts are not
        emailed when this is switched on. Days 1–6 and other follow-ups remain
        staff-selected.
      </small>
      {manager && (
        <button className="btn small" disabled={busy || !cfg}>
          Save workflow
        </button>
      )}
    </form>
  );
}
function TemplateEditor({
  existing,
  ws,
  busy,
  run,
  error,
  editable,
  onClose,
}: {
  existing?: EmailTemplate;
  ws: Workspace;
  busy: boolean;
  run: Run;
  error: string;
  editable: boolean;
  onClose: () => void;
}) {
  const [id] = useState(existing?.id ?? crypto.randomUUID()),
    [name, setName] = useState(existing?.name ?? ""),
    [category, setCategory] = useState(existing?.category ?? "Other"),
    [subject, setSubject] = useState(existing?.subject ?? ""),
    [body, setBody] = useState(existing?.body ?? "Hi {{first_name}},\n\n"),
    [validation, setValidation] = useState("");
  const previewCustomer = {
    name: "Jordan Example",
    vehicle_interest: "2020 Honda Accord",
  } as import("../lib/model").Customer;
  const preview = renderEmailTemplate({ subject, body }, ws, previewCustomer);
  return (
    <Modal
      title={existing ? "Email template" : "New email template"}
      subtitle="Personalize the message; your signature is added when composing."
      wide
      onClose={onClose}
    >
      <form
        className="modal-form email-template-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setValidation("");
          const parsed = emailTemplateSchema.safeParse({
            name,
            category,
            subject,
            body,
          });
          if (!parsed.success) {
            setValidation(parsed.error.issues[0].message);
            return;
          }
          if (
            (
              await run(
                {
                  type: "save_email_template",
                  id,
                  revision: existing?.revision ?? 0,
                  template: parsed.data,
                },
                "Email template saved",
              )
            ).ok
          )
            onClose();
        }}
      >
        <div className="email-settings-grid">
          <label>
            Template name
            <input
              required
              maxLength={100}
              value={name}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              value={category}
              disabled={!editable}
              onChange={(e) => setCategory(e.target.value)}
            >
              {emailCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Subject
          <input
            required
            maxLength={250}
            value={subject}
            disabled={!editable}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label>
          Message
          <textarea
            aria-label="Message"
            required
            rows={10}
            maxLength={12000}
            value={body}
            disabled={!editable}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="email-token-list">
          <span>Personalization fields:</span>
          {emailTokens.map((token) => (
            <code key={token}>{`{{${token}}}`}</code>
          ))}
        </div>
        <details className="email-preview">
          <summary>Preview with sample customer</summary>
          <strong>{preview.subject}</strong>
          <p>{appendSignature(preview.body, personalSignature(ws))}</p>
        </details>
        {(validation || error) && (
          <p className="form-error" role="alert">
            {validation || error}
          </p>
        )}
        <div className="ops-actions">
          {editable && (
            <button className="btn primary" disabled={busy}>
              Save template
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}
