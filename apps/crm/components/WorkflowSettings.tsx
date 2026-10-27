"use client";
import { useState } from "react";
import { Plus, Clock, Pause, Play, Settings2 } from "lucide-react";
import { canManage, type Workspace, type Command } from "../lib/model";
import {
  workflowEvents,
  ruleSchema,
  type WorkflowRule,
} from "../lib/workflows";
import { Modal, Empty, SectionTitle } from "./ui";
type Run = (
  p: Command,
  message?: string,
) => Promise<{ ok: boolean; id?: string }>;
export function WorkflowSettings({
  ws,
  run,
  busy,
  demo,
}: {
  ws: Workspace;
  run: Run;
  busy: boolean;
  demo: boolean;
}) {
  const [editing, setEditing] = useState<WorkflowRule | "new" | null>(null);
  const rules = ws.workflow_rules ?? [];
  const pending = (ws.workflow_jobs ?? []).filter((j) =>
    ["scheduled", "queued"].includes(j.state),
  );
  const failed = (ws.workflow_jobs ?? []).filter((j) => j.state === "skipped");
  return (
    <section className="panel workflow-settings">
      <SectionTitle
        title="Automated follow-up"
        subtitle="Email and staff tasks, timed around each customer's next step."
        action={
          canManage(ws.member.role) && (
            <button className="btn" onClick={() => setEditing("new")}>
              <Plus size={15} />
              Add step
            </button>
          )
        }
      />
      <div className="workflow-summary">
        <span>
          <strong>{rules.filter((r) => r.enabled).length}</strong> active steps
        </span>
        <span>
          <strong>{pending.length}</strong> scheduled / queued
        </span>
        <span>
          <strong>{failed.length}</strong> skipped / needs review
        </span>
      </div>
      <p className="work-note">
        Email is active for future events. Lead follow-up stops when a customer
        replies, an appointment is arranged, or the deal closes. Quiet hours are
        6 PM–9 AM Eastern for steps with business hours enabled. Text delivery
        is inactive.
      </p>
      <p className="subtext">
        {demo
          ? "Demo only. No messages are sent."
          : ws.workflow_health?.last_run_at
            ? `Background scheduler last checked ${new Date(ws.workflow_health.last_run_at).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern.`
            : "Waiting for the first background scheduler check (up to five minutes)."}
      </p>
      <div className="workflow-rule-list">
        {rules.map((r) => (
          <div className="workflow-rule" key={r.id}>
            <span className={`workflow-dot ${r.enabled ? "on" : ""}`} />
            <div>
              <strong>{r.name}</strong>
              <small>
                {workflowEvents[r.event]} ·{" "}
                {r.channel === "email" ? "Email" : "Staff task"} ·{" "}
                {r.delay_minutes === 0
                  ? "Immediately"
                  : `${r.delay_minutes >= 1440 ? r.delay_minutes / 1440 : r.delay_minutes / 60} ${r.delay_minutes >= 1440 ? "days" : "hours"} ${r.event.startsWith("reminder_") ? "before" : "after"}`}
              </small>
            </div>
            <span>{r.enabled ? "On" : "Off"}</span>
            {canManage(ws.member.role) && (
              <button className="btn small" onClick={() => setEditing(r)}>
                <Settings2 size={14} />
                Edit
              </button>
            )}
          </div>
        ))}
      </div>
      {!rules.length && (
        <Empty
          title="Build a follow-up step"
          body="Choose the event, timing, and an editable email template or task."
        />
      )}
      {editing && (
        <RuleEditor
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          ws={ws}
          busy={busy}
          run={run}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function RuleEditor({
  rule,
  ws,
  busy,
  run,
  close,
}: {
  rule: WorkflowRule | null;
  ws: Workspace;
  busy: boolean;
  run: Run;
  close: () => void;
}) {
  const [draft, setDraft] = useState<
    Omit<WorkflowRule, "id" | "org_id" | "revision" | "enabled_from">
  >(
    () =>
      rule ?? {
        name: "",
        event: "new_lead" as const,
        enabled: true,
        channel: "email" as "email" | "task",
        template_id: ws.email_templates?.[0]?.id ?? null,
        delay_minutes: 1440,
        task_title: "",
        business_hours: true,
        stop_on_reply: true,
      },
  );
  const [error, setError] = useState("");
  const [id] = useState(() => rule?.id ?? crypto.randomUUID());
  const patch = (values: Partial<typeof draft>) =>
    setDraft({ ...draft, ...values });
  async function save() {
    const p = ruleSchema.safeParse(draft);
    if (!p.success) {
      setError(p.error.issues[0].message);
      return;
    }
    const result = await run(
      {
        type: "save_workflow_rule",
        id,
        revision: rule?.revision ?? 0,
        rule: p.data,
      },
      "Automation saved",
    );
    if (result.ok) close();
    else
      setError(
        "Couldn't save. Check the main error message or refresh if this step changed.",
      );
  }
  return (
    <Modal
      title={rule ? "Edit automated step" : "Add automated step"}
      onClose={close}
    >
      <div className="workflow-editor">
        <label>
          Step name
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            When
            <select
              value={draft.event}
              onChange={(e) =>
                patch({ event: e.target.value as typeof draft.event })
              }
            >
              {Object.entries(workflowEvents).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              value={draft.channel}
              onChange={(e) =>
                patch({ channel: e.target.value as "email" | "task" })
              }
            >
              <option value="email">Send email</option>
              <option value="task">Create staff task</option>
              <option disabled>Text · not connected</option>
            </select>
          </label>
          <label>
            {draft.event.startsWith("reminder_")
              ? "Minutes before appointment"
              : "Minutes after event"}
            <input
              type="number"
              min="0"
              max="527040"
              value={draft.delay_minutes}
              onChange={(e) => patch({ delay_minutes: Number(e.target.value) })}
            />
            <small>60 = 1 hour · 1,440 = 1 day</small>
          </label>
          <label>
            {draft.channel === "email" ? "Email template" : "Task title"}
            {draft.channel === "email" ? (
              <select
                value={draft.template_id ?? ""}
                onChange={(e) => patch({ template_id: e.target.value || null })}
              >
                <option value="">Choose template</option>
                {ws.email_templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.task_title}
                onChange={(e) => patch({ task_title: e.target.value })}
              />
            )}
          </label>
        </div>
        {draft.channel === "email" && (
          <div className="workflow-preview">
            <strong>
              {
                ws.email_templates?.find((t) => t.id === draft.template_id)
                  ?.subject
              }
            </strong>
            <pre>
              {
                ws.email_templates?.find((t) => t.id === draft.template_id)
                  ?.body
              }
            </pre>
            <small>
              Edit the wording in Email templates below. Personalization is
              filled at send time.
            </small>
          </div>
        )}
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.business_hours}
            onChange={(e) => patch({ business_hours: e.target.checked })}
          />
          Send during 9 AM–6 PM Eastern
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.stop_on_reply}
            onChange={(e) => patch({ stop_on_reply: e.target.checked })}
          />
          Stop this step if the customer replies
        </label>
        <p className="work-note">
          New timing applies to future events. Turning a step off cancels its
          pending messages. Turning it back on does not resend canceled emails.
        </p>
        {error && <p className="error-notice">{error}</p>}
        <div className="ops-actions">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            Save step
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function CustomerWorkflows({
  ws,
  customerId,
  run,
  busy,
}: {
  ws: Workspace;
  customerId: string;
  run: Run;
  busy: boolean;
}) {
  const paused =
    ws.workflow_pauses?.find((p) => p.customer_id === customerId)?.paused ??
    false;
  const jobs = (ws.workflow_jobs ?? [])
    .filter((j) => j.customer_id === customerId)
    .sort((a, b) => a.run_at.localeCompare(b.run_at));
  return (
    <section className="profile-work-section">
      <SectionTitle
        title="Automatic follow-up"
        action={
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(
                {
                  type: "pause_customer_workflows",
                  customer_id: customerId,
                  paused: !paused,
                },
                paused
                  ? "Future automation resumed"
                  : "Automatic follow-up paused",
              )
            }
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
            {paused ? "Resume" : "Pause"}
          </button>
        }
      />
      <p className="subtext">
        {paused
          ? "Paused. Canceled emails will not be resent."
          : "Email steps follow the customer's activity. Text delivery is inactive."}
      </p>
      <div className="workflow-job-list">
        {jobs.slice(-30).map((j) => (
          <div key={j.id}>
            <Clock size={14} />
            <span>
              <strong>
                {ws.workflow_rules?.find((r) => r.id === j.rule_id)?.name ??
                  workflowEvents[j.event as keyof typeof workflowEvents]}
              </strong>
              <small>
                {new Date(j.run_at).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                })}{" "}
                Eastern · {j.state}
                {j.reason ? ` · ${j.reason}` : ""}
              </small>
            </span>
            {["scheduled", "queued"].includes(j.state) && (
              <button
                className="text-btn"
                disabled={busy}
                onClick={() =>
                  run(
                    { type: "cancel_workflow_job", id: j.id },
                    "Step canceled",
                  )
                }
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
      {!jobs.length && (
        <p className="subtext">
          No scheduled steps. New opportunities, appointments and sale events
          enroll automatically.
        </p>
      )}
    </section>
  );
}
