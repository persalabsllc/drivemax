"use client";
import { useRef, useState } from "react";
import {
  appendSignature,
  personalSignature,
  renderEmailTemplate,
} from "../lib/email";
import { Mail, MessageSquare, Phone, Plus, Send, FileText } from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Command,
  type Task,
  type Quote,
  dayKey,
  isOpenTask,
  visibleTasks,
  canManage,
} from "../lib/model";
import { type Message, taskChannel, quoteMessage } from "../lib/operations";
import { Modal } from "./ui";
export type RunCommand = (
  c: Command,
  message?: string,
) => Promise<{ ok: boolean; id?: string; revision?: number }>;
export type Compose = {
  channel: "email" | "sms";
  draft?: Message;
  task?: Task;
  quote?: Quote;
  reply?: Message;
  opportunity_id?: string | null;
};
export function MessageComposer({
  ws,
  customer,
  compose,
  run,
  busy,
  onClose,
  onRefresh,
}: {
  ws: Workspace;
  customer: Customer;
  compose: Compose;
  run: RunCommand;
  busy: boolean;
  onClose: () => void;
  onRefresh?: () => Promise<void>;
}) {
  const { channel, draft, task, quote, reply } = compose;
  const [id] = useState(() => draft?.id ?? crypto.randomUUID());
  const [recipient, setRecipient] = useState(
    draft?.recipient ??
      reply?.recipient ??
      (channel === "email" ? customer.email : customer.phone),
  );
  const [subject, setSubject] = useState(
    draft?.subject ??
      (reply
        ? /^re:/i.test(reply.subject)
          ? reply.subject
          : `Re: ${reply.subject}`
        : quote
          ? `Your Drive Max quote · ${quote.vehicle}`
          : ""),
  );
  const [body, setBody] = useState(
    draft?.body ??
      (channel === "email"
        ? appendSignature(
            quote ? quoteMessage(quote, customer) : "",
            personalSignature(ws),
          )
        : quote
          ? quoteMessage(quote, customer)
          : ""),
  );
  const [error, setError] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [sending, setSending] = useState(false),
    [resultStatus, setResultStatus] = useState("");
  const lock = useRef(false);
  const stored = ws.messages?.find((m) => m.id === id),
    revision = stored?.revision ?? draft?.revision ?? 0;
  const connected =
    channel === "email" && ws.email_connection?.connected === true;
  const blocked = channel === "email" && customer.email_opt_out;
  const opportunityId =
    compose.opportunity_id ??
    quote?.opportunity_id ??
    draft?.opportunity_id ??
    task?.opportunity_id ??
    reply?.opportunity_id ??
    null;
  const submit = async (send: boolean) => {
    if (lock.current) return;
    if (send && (!connected || blocked)) return;
    lock.current = true;
    setSending(true);
    setError("");
    try {
      if (
        channel === "email" &&
        (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !subject.trim())
      )
        throw Error("Enter a valid email address and subject.");
      if (channel === "sms" && recipient.replace(/\D/g, "").length < 10)
        throw Error("Enter a phone number with area code.");
      if (
        !body.trim() ||
        (send && body.trim() === personalSignature(ws).trim())
      )
        throw Error("Write a message above your signature.");
      const result = await run(
        {
          type: "save_message",
          id,
          revision,
          customer_id: customer.id,
          opportunity_id: opportunityId,
          task_id: task?.id ?? draft?.task_id ?? null,
          quote_id: quote?.id ?? draft?.quote_id ?? null,
          channel,
          recipient,
          subject,
          body,
        },
        send ? "Email draft saved" : "Draft saved · nothing has been sent",
      );
      if (!result.ok)
        throw Error(
          "Draft could not be saved. Refresh if it was edited elsewhere, then try again.",
        );
      if (!send) {
        onClose();
        return;
      }
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          revision: result.revision ?? (stored || draft ? revision + 1 : 0),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(
          data.error || "Email could not be queued. Your draft is saved.",
        );
      setResultStatus(data.status);
      await onRefresh?.();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not prepare the email. Check its status before trying again.",
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  };
  return (
    <Modal
      title={channel === "sms" ? "Text message" : "Email message"}
      subtitle={`${customer.name}${task ? " · " + task.title : ""}`}
      wide
      onClose={() => {
        if (!sending) onClose();
      }}
    >
      {resultStatus ? (
        <div className="modal-form email-send-result">
          <h3>
            {resultStatus === "queued"
              ? "Email queued for delivery"
              : "Email already sent"}
          </h3>
          <p>
            The message is in this customer's email thread and activity. Its
            delivery status will update there.
          </p>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                "data-intent",
              ) === "send",
            );
          }}
        >
          <div
            className={`ops-connection ${connected ? "email-connected" : ""}`}
          >
            {connected ? (
              <>
                Sending from {ws.email_connection?.sender}. Customer replies
                return to this profile.
              </>
            ) : (
              <>
                {channel === "sms"
                  ? "SMS is not connected."
                  : ws.email_connection?.reason ||
                    "Email is not connected."}{" "}
                You can save a draft. Saved drafts never send automatically.
              </>
            )}
          </div>
          {blocked && (
            <p className="form-error">
              Email is stopped at this customer's request. You can still prepare
              a draft.
            </p>
          )}
          {channel === "email" && (
            <div className="email-template-picker">
              <label>
                Email template
                <select
                  aria-label="Email template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Write your own or select a template</option>
                  {[...(ws.email_templates ?? [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn small"
                disabled={!templateId || sending}
                onClick={() => {
                  const t = ws.email_templates?.find(
                    (t) => t.id === templateId,
                  );
                  if (!t) return;
                  const rendered = renderEmailTemplate(
                    t,
                    ws,
                    customer,
                    ws.opportunities.find((o) => o.id === opportunityId),
                  );
                  setSubject(rendered.subject);
                  setBody(
                    appendSignature(rendered.body, personalSignature(ws)),
                  );
                }}
              >
                Use template
              </button>
              <small>
                Replaces the current subject and message. Review before sending.
              </small>
            </div>
          )}
          <label>
            To
            <input
              type={channel === "email" ? "email" : "tel"}
              required
              maxLength={250}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={sending}
            />
          </label>
          {channel === "email" && (
            <label>
              Subject
              <input
                required
                maxLength={250}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
              />
            </label>
          )}
          {(quote || draft?.quote_id) && (
            <div className="ops-quote-attachment">
              <FileText size={16} />
              <span>
                Customer quote PDF
                {channel === "email"
                  ? " will be attached when sent"
                  : " saved with draft"}{" "}
                ·{" "}
                {quote?.vehicle ??
                  ws.quotes.find((q) => q.id === draft?.quote_id)?.vehicle}
              </span>
              <small>
                Internal costs, trade ACV and commissions are excluded from the
                customer copy.
              </small>
              <button
                className="text-btn"
                type="button"
                onClick={async () => {
                  const q =
                    quote ?? ws.quotes.find((q) => q.id === draft?.quote_id);
                  if (q)
                    try {
                      await (
                        await import("../lib/quote-export")
                      ).downloadCustomerQuote(q, customer);
                    } catch {
                      setError("Could not generate the quote PDF. Try again.");
                    }
                }}
              >
                Preview / download quote PDF
              </button>
            </div>
          )}
          <label>
            Message
            <textarea
              aria-label="Message"
              rows={channel === "email" ? 12 : 7}
              required
              maxLength={16000}
              value={body}
              disabled={sending}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {channel === "email" && (
            <small className="ops-help">
              Your signature is included in new emails and can be edited here.
              Change the default in Settings → Email & follow-up.
            </small>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ops-actions">
            <button
              className="btn"
              data-intent="draft"
              disabled={busy || sending}
            >
              Save draft
            </button>
            {draft && (
              <button
                type="button"
                className="btn"
                disabled={busy || sending}
                onClick={async () => {
                  if (
                    (
                      await run(
                        { type: "delete_message_draft", id, revision },
                        "Draft discarded",
                      )
                    ).ok
                  )
                    onClose();
                }}
              >
                Discard draft
              </button>
            )}
            <button
              className="btn primary"
              data-intent="send"
              disabled={busy || sending || !connected || !!blocked}
              title={
                connected
                  ? "Send this email to the customer"
                  : "Connect email to enable sending"
              }
            >
              <Send size={15} />
              {sending
                ? "Preparing…"
                : connected
                  ? "Send email"
                  : "Send · not connected"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export function Communications({
  ws,
  customer,
  channel,
  onCompose,
  run,
  busy,
  onRefresh,
}: {
  ws: Workspace;
  customer: Customer;
  channel: "sms" | "email";
  onCompose: (c: Compose) => void;
  run?: RunCommand;
  busy?: boolean;
  onRefresh?: () => Promise<void>;
}) {
  const [scope, setScope] = useState("all"),
    [preference, setPreference] = useState(false);
  const messages = (ws.messages ?? [])
    .filter(
      (m) =>
        m.customer_id === customer.id &&
        m.channel === channel &&
        m.status !== "canceled" &&
        (scope === "all" || (m.opportunity_id ?? "general") === scope),
    )
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  const logged = ws.activities.filter(
    (a) =>
      a.customer_id === customer.id &&
      a.kind === channel &&
      (scope === "all" || (a.opportunity_id ?? "general") === scope),
  );
  const entries = [
    ...messages.map((m) => ({
      id: m.id,
      at: m.created_at,
      message: m,
      log: null,
    })),
    ...logged.map((a) => ({
      id: a.id,
      at: a.created_at,
      message: null,
      log: a,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return (
    <section className={`profile-body ops-conversation ${channel}`}>
      <div className="section-heading">
        <div>
          <h3>
            {channel === "sms" ? "Text conversation" : "Email conversation"}
          </h3>
          <p>All purchases and follow-up in one customer history.</p>
        </div>
        <button
          className="btn primary small"
          onClick={() =>
            onCompose({
              channel,
              opportunity_id:
                scope === "all" || scope === "general" ? null : scope,
            })
          }
        >
          <Plus size={15} />
          Compose {channel === "sms" ? "text" : "email"}
        </button>
      </div>
      {channel === "email" && (
        <div className="email-preference">
          <span>
            {customer.email_opt_out
              ? "Email stopped at customer request"
              : "Email follow-up allowed"}
          </span>
          {run && (
            <button className="text-btn" onClick={() => setPreference(true)}>
              {customer.email_opt_out
                ? "Record renewed permission"
                : "Stop email follow-up"}
            </button>
          )}
          {onRefresh && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              Refresh conversation
            </button>
          )}
        </div>
      )}
      {preference && run && (
        <Modal
          title="Customer email preference"
          subtitle={customer.name}
          onClose={() => setPreference(false)}
        >
          <div className="modal-form">
            <p>
              {customer.email_opt_out
                ? "Only restore email follow-up if this customer has asked to receive emails again. Provider blocks for bounces or complaints will remain in place."
                : "Record that this customer has requested no further emails. This stops new sends and pending emails for the customer."}
            </p>
            <div className="ops-actions">
              <button className="btn" onClick={() => setPreference(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    (
                      await run(
                        {
                          type: "set_email_opt_out",
                          customer_id: customer.id,
                          opted_out: !customer.email_opt_out,
                        },
                        "Email preference updated",
                      )
                    ).ok
                  )
                    setPreference(false);
                }}
              >
                {customer.email_opt_out ? "Restore permission" : "Stop emails"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <label className="ops-thread-filter">
        Conversation scope
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All opportunities & general messages</option>
          <option value="general">General customer</option>
          {ws.opportunities
            .filter((o) => o.customer_id === customer.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} · {o.status}
              </option>
            ))}
        </select>
      </label>
      <div
        className="ops-thread"
        aria-label={channel === "sms" ? "Text message thread" : "Email thread"}
      >
        {entries.map(({ id, at, message: m, log }) => (
          <article
            key={id}
            className={`ops-message ${m?.direction ?? "logged"} ${m?.status ?? "logged"}`}
          >
            <header>
              <strong>
                {m
                  ? m.direction === "inbound"
                    ? "Received"
                    : m.status === "draft"
                      ? "Draft · not sent"
                      : m.status.charAt(0).toUpperCase() + m.status.slice(1)
                  : "Manually logged"}
              </strong>
              <time>
                {new Date(at).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                })}
              </time>
            </header>
            {m?.subject && <h4>{m.subject}</h4>}
            <p>{m?.body ?? log?.body}</p>
            {m?.error && <p className="email-delivery-note">{m.error}</p>}
            <footer>
              {m ? (
                <>
                  <span>
                    {m.recipient} · {m.status}
                    {m.quote_id ? " · quote reference" : ""}
                  </span>
                  {m.status === "draft" &&
                    (m.created_by === ws.member.id ||
                      canManage(ws.member.role)) && (
                      <button
                        className="text-btn"
                        onClick={() => onCompose({ channel, draft: m })}
                      >
                        Edit draft
                      </button>
                    )}
                  {m.direction === "inbound" && (
                    <button
                      className="text-btn"
                      onClick={() =>
                        onCompose({
                          channel,
                          opportunity_id: m.opportunity_id,
                          reply: m,
                        })
                      }
                    >
                      Reply
                    </button>
                  )}
                </>
              ) : (
                <span>{log?.created_by} · delivery not tracked</span>
              )}
            </footer>
          </article>
        ))}
        {!entries.length && (
          <div className="ops-empty-thread">
            {channel === "sms" ? (
              <MessageSquare size={28} />
            ) : (
              <Mail size={28} />
            )}
            <h3>Your conversation starts here.</h3>
            <p>
              Saved drafts and future incoming and outgoing{" "}
              {channel === "sms" ? "texts" : "emails"} appear in time order.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
export function CustomerTasks({
  ws,
  customer,
  onTask,
}: {
  ws: Workspace;
  customer: Customer;
  onTask: (t: Task) => void;
}) {
  const today = dayKey(),
    tasks = visibleTasks(ws)
      .filter((t) => t.customer_id === customer.id && isOpenTask(t))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <section className="ops-customer-tasks" aria-label="Open customer tasks">
      <div className="section-heading">
        <div>
          <h3>
            Open tasks <span className="ops-count">{tasks.length}</span>
          </h3>
          <p>Across all opportunities</p>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="ops-task-grid">
          {tasks.map((t) => {
            const state =
                t.due_date < today
                  ? "overdue"
                  : t.due_date === today
                    ? "today"
                    : "upcoming",
              channel = taskChannel(t);
            return (
              <button
                key={t.id}
                className={`ops-task ${state}`}
                onClick={() => onTask(t)}
              >
                <span className="ops-task-status">
                  {state === "overdue"
                    ? "Past due"
                    : state === "today"
                      ? "Due today"
                      : "Upcoming"}{" "}
                  · {t.due_date}
                </span>
                <strong>{t.title}</strong>
                <small>
                  {channel === "sms" ? (
                    <MessageSquare size={13} />
                  ) : channel === "email" ? (
                    <Mail size={13} />
                  ) : (
                    <Phone size={13} />
                  )}{" "}
                  {channel === "sms"
                    ? "Text"
                    : channel === "email"
                      ? "Email"
                      : channel === "call"
                        ? "Call"
                        : "Task"}{" "}
                  ·{" "}
                  {ws.staff.find((m) => m.id === t.assigned_to)?.name ??
                    "Unassigned"}
                </small>
              </button>
            );
          })}
        </div>
      )}
      {!tasks.length && (
        <p className="ops-help">No open tasks for this customer.</p>
      )}
    </section>
  );
}
export function TaskAction({
  ws,
  customer,
  task,
  run,
  busy,
  onCompose,
  onClose,
}: {
  ws: Workspace;
  customer: Customer;
  task: Task;
  run: RunCommand;
  busy: boolean;
  onCompose: (c: Compose) => void;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState(taskChannel(task)),
    [notes, setNotes] = useState(""),
    [error, setError] = useState("");
  const live = ws.tasks.find((t) => t.id === task.id) ?? task;
  return (
    <Modal
      title={task.title}
      subtitle={`${customer.name} · due ${task.due_date}`}
      onClose={onClose}
    >
      <div className="modal-form">
        <label>
          Action
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            <option value="call">Call customer</option>
            <option value="sms">Text customer</option>
            <option value="email">Email customer</option>
            <option value="task">General task</option>
          </select>
        </label>
        {channel === "call" ? (
          <>
            <a
              className="btn primary"
              href={
                customer.phone
                  ? `tel:${customer.phone.replace(/[^+\d]/g, "")}`
                  : undefined
              }
              aria-disabled={!customer.phone}
            >
              <Phone size={16} />
              {customer.phone
                ? `Call ${customer.phone}`
                : "Add a phone number first"}
            </a>
            <label>
              Call outcome / notes
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Spoke with customer, left voicemail…"
              />
            </label>
            <button
              className="btn"
              disabled={busy || !notes.trim()}
              onClick={async () => {
                const r = await run(
                  {
                    type: "add_activity",
                    customer_id: customer.id,
                    opportunity_id: task.opportunity_id ?? null,
                    kind: "call",
                    body: notes,
                  },
                  "Call outcome logged",
                );
                if (r.ok) {
                  setNotes("");
                  setError("");
                } else setError("Could not save the call outcome.");
              }}
            >
              Save call outcome
            </button>
          </>
        ) : channel !== "task" ? (
          <button
            className="btn primary"
            onClick={() => onCompose({ channel, task })}
          >
            Open {channel === "sms" ? "text" : "email"} composer
          </button>
        ) : (
          <p className="ops-help">
            Complete the task after the work is finished.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn"
          disabled={busy || !isOpenTask(live)}
          onClick={async () => {
            if (
              (
                await run(
                  { type: "complete_task", id: task.id },
                  "Task completed",
                )
              ).ok
            )
              onClose();
            else setError("Could not complete the task.");
          }}
        >
          {isOpenTask(live) ? "Mark task complete" : "Task completed"}
        </button>
        <p className="ops-help">
          Opening a call or saving a draft does not complete this task.
        </p>
      </div>
    </Modal>
  );
}
