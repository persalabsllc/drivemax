"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  CheckCircle2,
  Globe,
  MessageSquare,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { canManage, myStaffId, type Workspace } from "../lib/model";
import type {
  WebsiteChatData,
  WebsiteChatSettings,
  WebsiteChatThread,
} from "../lib/website-chat";
const stamp = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const stateLabel = {
  ai: "AI assisting",
  waiting: "Needs a person",
  human: "Staff chatting",
  closed: "Closed",
};
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
async function chatRequest(
  command?: Record<string, unknown>,
): Promise<WebsiteChatData> {
  const response = await fetch(
      "/api/website-chat",
      command
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(command),
          }
        : { cache: "no-store" },
    ),
    data = await response.json();
  if (!response.ok) throw Error(data.error || "Website chat is unavailable.");
  return data;
}
function demoData(ws: Workspace): WebsiteChatData {
  const id = "demo-website-chat",
    at = new Date().toISOString();
  return {
    threads: [
      {
        id,
        state: "waiting",
        assigned_to: null,
        customer_id: null,
        opportunity_id: null,
        visitor_name: "Jordan · demo visitor",
        visitor_email: "jordan@example.invalid",
        visitor_phone: "",
        intent: "availability",
        page_path: "/inventory",
        appointment_id: null,
        unread: true,
        updated_at: at,
        preview: "Could I stop by to look at an SUV this week?",
      },
    ],
    conversation: {
      id,
      state: "waiting",
      contact_saved: true,
      busy: false,
      appointment: null,
      messages: [
        {
          id: "demo-chat-1",
          sender: "assistant",
          body: "Hi! I'm Kyle's AI assistant at Drive Max. What can I help you find?",
          staff_name: null,
          created_at: at,
          data: {},
        },
        {
          id: "demo-chat-2",
          sender: "visitor",
          body: "Could I stop by to look at an SUV this week?",
          staff_name: null,
          created_at: at,
          data: {},
        },
        {
          id: "demo-chat-3",
          sender: "system",
          body: "Visitor requested a staff member. This is a fictional conversation for the CRM demo.",
          staff_name: null,
          created_at: at,
          data: {},
        },
      ],
    },
    staff: ws.staff
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name })),
    settings: {
      enabled: true,
      ai_enabled: true,
      booking_enabled: true,
      public_name: "Kyle's AI assistant",
      greeting: "Hi! I'm Kyle's AI assistant at Drive Max. How can I help?",
      assigned_to: null,
      monthly_budget: 25,
    },
    usage: { estimated_spend: 0, replies: 0, unavailable: 0, pending: 0 },
  };
}
export function WebsiteChatInbox({
  ws,
  demo,
  initialId,
  onCustomer,
}: {
  ws: Workspace;
  demo: boolean;
  initialId?: string;
  onCustomer: (customerId: string, opportunityId: string | null) => void;
}) {
  const [data, setData] = useState<WebsiteChatData | null>(() =>
      demo ? demoData(ws) : null,
    ),
    [id, setId] = useState(initialId || (demo ? "demo-website-chat" : "")),
    [filter, setFilter] = useState("open"),
    [search, setSearch] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0),
    pending = useRef(false),
    bottom = useRef<HTMLDivElement>(null),
    retry = useRef<{ id: string; body: string; key: string } | null>(null);
  const me = myStaffId(ws),
    manager = canManage(ws.member.role);
  useEffect(() => {
    if (initialId) setId(initialId);
  }, [initialId]);
  const load = useCallback(async () => {
    if (demo) return;
    const seq = ++sequence.current;
    try {
      const next = await chatRequest(id ? { action: "read", id } : undefined);
      if (seq === sequence.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current)
        setError(e instanceof Error ? e.message : "Please refresh.");
    }
  }, [demo, id]);
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden && !pending.current) load();
    }, 5000);
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, [load]);
  const conversation = data?.conversation?.id === id ? data.conversation : null;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [id, conversation?.messages.length]);
  const current = data?.threads.find((t) => t.id === id),
    draft = drafts[id] || "";
  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    sequence.current++;
    try {
      if (demo) {
        setData((old) => {
          if (!old || !old.conversation) return old;
          const state =
            action === "take"
              ? "human"
              : action === "release"
                ? "ai"
                : action === "close"
                  ? "closed"
                  : old.conversation.state;
          return {
            ...old,
            threads: old.threads.map((t) =>
              t.id === id
                ? {
                    ...t,
                    state,
                    assigned_to: action === "take" ? me || null : t.assigned_to,
                    unread: false,
                  }
                : t,
            ),
            conversation: {
              ...old.conversation,
              state,
              messages:
                action === "reply"
                  ? [
                      ...old.conversation.messages,
                      {
                        id: crypto.randomUUID(),
                        sender: "staff",
                        body: String(extra.body),
                        staff_name: ws.member.name,
                        created_at: new Date().toISOString(),
                        data: {},
                      },
                    ]
                  : old.conversation.messages,
            },
          };
        });
      } else {
        setData(await chatRequest({ action, id, ...extra }));
      }
      if (action === "reply") {
        setDrafts((old) => ({ ...old, [id]: "" }));
        retry.current = null;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function reply(e: FormEvent) {
    e.preventDefault();
    if (retry.current?.id !== id || retry.current.body !== draft)
      retry.current = { id, body: draft, key: crypto.randomUUID() };
    void command("reply", { body: draft, request_id: retry.current.key });
  }
  const rows = (data?.threads || []).filter(
    (t) =>
      (filter === "all" ||
        (filter === "mine" && t.assigned_to === me) ||
        (filter === "waiting" && t.state === "waiting") ||
        (filter === "open" && t.state !== "closed")) &&
      [t.visitor_name, t.visitor_email, t.preview]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="panel website-chat-inbox">
      <div className="section-heading">
        <div>
          <span className="eyebrow">WEBSITE CONVERSATIONS</span>
          <h2>Be there when they’re ready.</h2>
          <p>
            Watch the conversation, take over, and keep every lead connected.
          </p>
        </div>
        <button className="btn secondary" disabled={busy} onClick={load}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {demo && (
        <div className="notice">
          Demo conversation · no messages are sent to visitors.
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="wc-layout">
        <aside className="wc-queue">
          <div className="wc-queue-controls">
            <label className="sr-only" htmlFor="wc-search">
              Search conversations
            </label>
            <input
              id="wc-search"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Conversation filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="open">Open conversations</option>
              <option value="waiting">Needs a person</option>
              <option value="mine">Assigned to me</option>
              <option value="all">All recent conversations</option>
            </select>
          </div>
          {rows.map((t) => (
            <button
              key={t.id}
              className={"wc-queue-item " + (id === t.id ? "selected" : "")}
              onClick={() => setId(t.id)}
            >
              <span className="wc-person">
                <span>{t.visitor_name || "Website visitor"}</span>
                {t.unread && <i aria-label="Unread" />}
              </span>
              <span className={"wc-status wc-status-" + t.state}>
                {stateLabel[t.state]}
              </span>
              <p>{t.preview}</p>
              <small>{stamp(t.updated_at)}</small>
            </button>
          ))}
          {!rows.length && (
            <div className="wc-empty">
              <MessageSquare size={24} />
              <p>
                {data
                  ? "No conversations in this view yet."
                  : "Loading conversations…"}
              </p>
            </div>
          )}
        </aside>
        <div className="wc-conversation">
          {current ? (
            <>
              <div className="wc-conversation-heading">
                <div>
                  <h3>{current.visitor_name || "Website visitor"}</h3>
                  <p>
                    {[current.visitor_phone, current.visitor_email]
                      .filter(Boolean)
                      .join(" · ") || "Contact details not yet shared"}
                  </p>
                  <div className="wc-context">
                    <span>
                      <Globe size={12} />
                      {current.page_path}
                    </span>
                    {current.appointment_id && (
                      <span>
                        <CheckCircle2 size={12} /> Appointment booked
                      </span>
                    )}
                    {current.customer_id && (
                      <button
                        onClick={() =>
                          onCustomer(
                            current.customer_id!,
                            current.opportunity_id,
                          )
                        }
                      >
                        Open customer ↗
                      </button>
                    )}
                  </div>
                </div>
                <span className={"wc-status wc-status-" + current.state}>
                  {stateLabel[current.state]}
                </span>
              </div>
              <div className="wc-actions">
                {current.state !== "closed" && (
                  <>
                    {(current.state !== "human" ||
                      current.assigned_to !== me) && (
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() => command("take")}
                      >
                        <UserRound size={14} /> Take over
                      </button>
                    )}
                    {current.state === "human" &&
                      current.assigned_to === me && (
                        <button
                          className="btn secondary"
                          disabled={busy}
                          onClick={() => command("release")}
                        >
                          <Sparkles size={14} /> Return to AI
                        </button>
                      )}
                    <button
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => command("close")}
                    >
                      Close chat
                    </button>
                  </>
                )}
                {manager && (
                  <select
                    aria-label="Assign conversation"
                    value={current.assigned_to || ""}
                    disabled={busy || current.state === "closed"}
                    onChange={(e) =>
                      command("assign", { assigned_to: e.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {data?.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="wc-transcript" role="log" aria-live="polite">
                {conversation?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={"wc-message wc-message-" + m.sender}
                  >
                    <span>
                      {m.sender === "visitor"
                        ? "Visitor"
                        : m.sender === "staff"
                          ? m.staff_name
                          : m.sender === "assistant"
                            ? "Drive Max AI"
                            : "System"}{" "}
                      <time>{stamp(m.created_at)}</time>
                    </span>
                    <p>{m.body}</p>
                    {m.data.vehicles?.map((v) => (
                      <a
                        key={v.href}
                        href={"https://www.drivemaxusedcars.com" + v.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.title} · {money(v.total)} · {v.status} ↗
                      </a>
                    ))}
                  </div>
                ))}
                {conversation?.busy && (
                  <p className="wc-ai-working">
                    AI is preparing a reply. Taking over stops that reply.
                  </p>
                )}
                <div ref={bottom} />
              </div>
              {current.state === "human" && current.assigned_to === me ? (
                <form className="wc-reply" onSubmit={reply}>
                  <label className="sr-only" htmlFor="wc-reply">
                    Reply to visitor
                  </label>
                  <textarea
                    id="wc-reply"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((old) => ({ ...old, [id]: e.target.value }))
                    }
                    placeholder="Your reply to the visitor…"
                    maxLength={2000}
                    rows={2}
                    disabled={busy}
                  />
                  <button
                    className="btn primary"
                    disabled={busy || !draft.trim()}
                  >
                    <ArrowUp size={17} /> Send
                  </button>
                </form>
              ) : (
                <div className="wc-reply-note">
                  {current.state === "closed"
                    ? "This conversation is closed."
                    : current.state === "human"
                      ? "The assigned staff member is handling this conversation."
                      : "Take over to reply as yourself. The AI will pause immediately."}
                </div>
              )}
            </>
          ) : (
            <div className="wc-empty wc-empty-large">
              <MessageSquare size={32} />
              <h3>A conversation can become a customer.</h3>
              <p>
                Select a chat to see the transcript, respond, or open the
                customer’s record.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function WebsiteChatSettingsPanel({
  ws,
  demo,
}: {
  ws: Workspace;
  demo: boolean;
}) {
  const [data, setData] = useState<WebsiteChatData | null>(() =>
      demo ? demoData(ws) : null,
    ),
    [draft, setDraft] = useState<WebsiteChatSettings | null>(() =>
      demo ? demoData(ws).settings : null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    let cancel = false;
    chatRequest()
      .then((d) => {
        if (!cancel) {
          setData(d);
          setDraft(d.settings);
        }
      })
      .catch(() => {
        if (!cancel) setError("Website chat settings could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, [demo]);
  if (!canManage(ws.member.role)) return null;
  const change = <K extends keyof WebsiteChatSettings>(
    key: K,
    value: WebsiteChatSettings[K],
  ) => setDraft((old) => (old ? { ...old, [key]: value } : old));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!demo) {
        const next = await chatRequest({ action: "settings", settings: draft });
        setData(next);
        setDraft(next.settings);
      }
      setMessage(
        demo ? "Saved in this demo only." : "Website chat settings saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel wc-settings">
      <div className="section-heading">
        <div>
          <h2>Website chat</h2>
          <p>Your AI assistant, team inbox, and online appointment controls.</p>
        </div>
        <Globe size={22} />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {draft && (
        <form onSubmit={save}>
          <div className="wc-settings-toggles">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => change("enabled", e.target.checked)}
              />{" "}
              Show chat on the website
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.ai_enabled}
                onChange={(e) => change("ai_enabled", e.target.checked)}
              />{" "}
              AI replies
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.booking_enabled}
                onChange={(e) => change("booking_enabled", e.target.checked)}
              />{" "}
              Online booking
            </label>
          </div>
          <div className="form-grid">
            <label>
              Public assistant name
              <input
                required
                maxLength={60}
                value={draft.public_name}
                onChange={(e) => change("public_name", e.target.value)}
              />
            </label>
            <label>
              Default lead & appointment owner
              <select
                value={draft.assigned_to || ""}
                onChange={(e) => change("assigned_to", e.target.value || null)}
              >
                <option value="">Automatic active staff</option>
                {data?.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monthly AI budget ($)
              <input
                type="number"
                min={0}
                max={500}
                step="0.01"
                required
                value={draft.monthly_budget}
                onChange={(e) =>
                  change("monthly_budget", Number(e.target.value))
                }
              />
            </label>
            <label>
              Welcome message
              <textarea
                required
                rows={3}
                maxLength={400}
                value={draft.greeting}
                onChange={(e) => change("greeting", e.target.value)}
              />
            </label>
          </div>
          <div className="wc-usage">
            <span>
              <b>{money(Number(data?.usage?.estimated_spend || 0))}</b>{" "}
              estimated use / reserved this month
            </span>
            <span>
              <b>{data?.usage?.replies || 0}</b> AI replies
            </span>
            <span>
              <b>{data?.usage?.unavailable || 0}</b> provider interruptions
            </span>
          </div>
          <p className="muted">
            The assistant uses live public inventory and approved protection
            descriptions. Staff takeover pauses AI. At the budget limit or if AI
            is unavailable, visitors can leave contact details and book a visit.
            Usage estimates include a $0.50 reservation for unfinished or failed
            requests; provider billing is separate.
          </p>
          <p className="muted">
            Online visits: 60 minutes, at least 2 hours ahead, within the next
            14 days. Tuesday–Friday 9–5 and Saturday 12–4 Eastern, excluding the
            assigned rep’s booked times. Monday and Sunday visits are arranged
            by staff. Kyle’s website photo is used with a visible AI label.
          </p>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save website chat settings"}
          </button>
        </form>
      )}
    </section>
  );
}
