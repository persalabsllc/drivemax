"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname } from "next/navigation";
import {
  ArrowUp,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  CHAT_ASSISTANT_PHOTO,
  type ChatConfig,
  type ChatSnapshot,
  type ChatSlot,
} from "../../lib/website-chat";

const fallbackConfig: ChatConfig = {
  enabled: true,
  public_name: "Kyle's AI assistant",
  greeting: "Hi! I'm Kyle's AI assistant at Drive Max. How can I help?",
  photo: CHAT_ASSISTANT_PHOTO,
  phone: "252-541-0040",
  booking_enabled: true,
};
const choices = [
  {
    label: "Check vehicle availability",
    text: "I'd like to check availability on a vehicle.",
    intent: "availability",
    Icon: Car,
  },
  {
    label: "Sell or trade my car",
    text: "I'd like to sell or trade my car.",
    intent: "sell",
    Icon: Car,
  },
  {
    label: "Protection & warranty",
    text: "I have a question about protection coverage.",
    intent: "protection",
    Icon: ShieldCheck,
  },
];
const dollars = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
export default function WebsiteChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false),
    [config, setConfig] = useState<ChatConfig>(fallbackConfig),
    [conversation, setConversation] = useState<ChatSnapshot | null>(null),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [screen, setScreen] = useState<"chat" | "contact" | "slots">("chat"),
    [slots, setSlots] = useState<ChatSlot[]>([]),
    [selected, setSelected] = useState<ChatSlot | null>(null),
    [expired, setExpired] = useState(false);
  const panel = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    messageInput = useRef<HTMLTextAreaElement>(null),
    request = useRef<{ body: string; id: string } | null>(null),
    inFlight = useRef(false),
    sequence = useRef(0),
    applied = useRef(0);
  const hidden =
    pathname.startsWith("/control-room") || pathname.startsWith("/apply");
  const apply = useCallback((value: ChatSnapshot | null, seq: number) => {
    if (seq >= applied.current) {
      applied.current = seq;
      setConversation(value);
    }
  }, []);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    const r = await fetch("/api/chat", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    if (d.config) setConfig(d.config);
    apply(d.conversation, seq);
    return d.conversation as ChatSnapshot | null;
  }, [apply]);
  useEffect(() => {
    if (!hidden) load().catch(() => {});
  }, [hidden, load]);
  useEffect(() => {
    if (!open || hidden) return;
    const timer = setInterval(() => {
      if (!document.hidden && !inFlight.current) load().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [open, hidden, load]);
  useEffect(() => {
    if (open && screen === "chat")
      bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [conversation?.messages.length, conversation?.busy, open, screen]);
  useEffect(() => {
    if (!open) return;
    const old = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ) || [],
      ).filter((e) => e.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes.at(-1)!;
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      old?.focus();
    };
  }, [open]);
  async function post(payload: Record<string, unknown>) {
    const seq = ++sequence.current,
      r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      d = await r.json();
    if (!r.ok) {
      if (d.expired) {
        setExpired(true);
        setConversation(null);
      }
      throw Error(d.error || "Please try again.");
    }
    if (d.conversation) apply(d.conversation, seq);
    return d;
  }
  async function act(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function start() {
    await act(async () => {
      await post({ action: "start", page_path: pathname });
      setExpired(false);
      setScreen("chat");
    });
  }
  async function show() {
    setOpen(true);
    if (!conversation) await start();
  }
  async function send(text = draft, intent?: string) {
    if (!text.trim() || conversation?.busy || busy) return;
    await act(async () => {
      if (!conversation) await post({ action: "start", page_path: pathname });
      if (request.current?.body !== text)
        request.current = { body: text, id: crypto.randomUUID() };
      await post({
        action: "message",
        body: text.trim(),
        request_id: request.current.id,
        page_path: pathname,
        intent,
      });
      request.current = null;
      setDraft("");
      setScreen("chat");
    });
    messageInput.current?.focus();
  }
  async function appointments() {
    if (!conversation?.contact_saved) {
      setScreen("contact");
      return;
    }
    await act(async () => {
      const d = await post({ action: "slots" });
      setSlots(d.slots);
      setSelected(null);
      setScreen("slots");
    });
  }
  async function saveContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await act(async () => {
      await post({
        action: "contact",
        name: form.get("name"),
        email: form.get("email") || "",
        phone: form.get("phone") || "",
        consent: form.get("consent") === "on",
      });
      setScreen("chat");
    });
  }
  if (hidden || !config.enabled) return null;
  return (
    <div className="dm-chat">
      {!open && (
        <button
          className="dm-chat-launcher"
          ref={launcher}
          onClick={show}
          aria-label="Chat with Drive Max"
          aria-expanded={open}
        >
          <span className="dm-chat-launcher-icon">
            <MessageCircle size={24} />
            <i />
          </span>
          <span>
            Let’s talk<span>Drive Max · AI + our team</span>
          </span>
        </button>
      )}
      {open && (
        <div
          className="dm-chat-panel"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dm-chat-title"
          tabIndex={-1}
        >
          <header className="dm-chat-header">
            <img
              src={config.photo}
              alt="AI-generated Drive Max assistant portrait"
              width={48}
              height={48}
            />
            <div>
              <span className="dm-chat-eyebrow">
                <Sparkles size={11} /> DRIVE MAX
              </span>
              <h2 id="dm-chat-title">
                {conversation?.state === "human"
                  ? "Our team is here"
                  : config.public_name}
              </h2>
              <p>
                {conversation?.state === "human"
                  ? "A staff member has joined"
                  : conversation?.state === "waiting"
                    ? "Waiting for the team"
                    : "AI assistant · Ask us anything"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat">
              <X size={20} />
            </button>
          </header>
          {screen !== "chat" && (
            <button className="dm-chat-back" onClick={() => setScreen("chat")}>
              <ChevronLeft size={16} /> Back to conversation
            </button>
          )}
          {screen === "chat" ? (
            <div
              className="dm-chat-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {!conversation && (
                <div className="dm-chat-welcome">
                  <Sparkles size={24} />
                  <h3>A little help, right here.</h3>
                  <p>Browse, ask a question, or plan your visit.</p>
                  {expired && (
                    <button className="dm-chat-primary" onClick={start}>
                      Start a new chat
                    </button>
                  )}
                </div>
              )}
              {conversation?.messages.map((m) => (
                <div
                  key={m.id}
                  className={"dm-chat-message dm-chat-message-" + m.sender}
                >
                  <span className="dm-chat-sender">
                    {m.sender === "visitor"
                      ? "You"
                      : m.sender === "staff"
                        ? m.staff_name
                        : m.sender === "assistant"
                          ? "Drive Max AI"
                          : "Drive Max"}
                  </span>
                  <p>{m.body}</p>
                  {m.data.vehicles?.map((v) => (
                    <a className="dm-chat-vehicle" key={v.href} href={v.href}>
                      {v.image && (
                        <img
                          src={v.image}
                          alt={v.title}
                          width={80}
                          height={64}
                        />
                      )}
                      <span>
                        <strong>{v.title}</strong>
                        <small>
                          {v.miles.toLocaleString()} miles · {v.status}
                        </small>
                        <b>{dollars(v.total)} total</b>
                        <small>
                          {dollars(v.price)} + $399 dealer fee · Taxes/title
                          extra
                        </small>
                      </span>
                    </a>
                  ))}
                  {(m.data.contact || m.data.appointments) && (
                    <div className="dm-chat-inline-actions">
                      {m.data.contact && !conversation.contact_saved && (
                        <button onClick={() => setScreen("contact")}>
                          Share contact details
                        </button>
                      )}
                      {m.data.appointments && config.booking_enabled && (
                        <button onClick={appointments}>Choose a visit</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {conversation && conversation.messages.length <= 1 && (
                <div className="dm-chat-choices">
                  {choices.map(({ label, text, intent, Icon }) => (
                    <button
                      key={intent}
                      disabled={busy}
                      onClick={() => send(text, intent)}
                    >
                      <Icon size={17} />
                      {label}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              )}
              {conversation?.busy && (
                <div className="dm-chat-typing" role="status">
                  <i />
                  <i />
                  <i />
                  <span>Looking into that…</span>
                </div>
              )}
              <div ref={bottom} />
            </div>
          ) : screen === "contact" ? (
            <form className="dm-chat-form" onSubmit={saveContact}>
              <span className="dm-chat-form-icon">
                <UserRound size={23} />
              </span>
              <h3>Let’s stay in touch.</h3>
              <p>
                Enter your details once. We’ll attach your conversation so the
                team can pick up where you left off.
              </p>
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                Phone
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  placeholder="(252) 555-0123"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  placeholder="you@example.com"
                />
              </label>
              <small>Provide a phone number or email.</small>
              <label className="dm-chat-consent">
                <input name="consent" type="checkbox" required />
                <span>
                  Drive Max may call or email me about this inquiry. This does
                  not sign me up for text messages.
                </span>
              </label>
              <button className="dm-chat-primary" disabled={busy}>
                {busy ? "Saving…" : "Save my details"}
                <Check size={17} />
              </button>
            </form>
          ) : (
            <div className="dm-chat-form">
              <span className="dm-chat-form-icon">
                <CalendarDays size={23} />
              </span>
              <h3>Make time for a test drive.</h3>
              <p>
                Choose a 60-minute visit. All times are Eastern. Selling a car
                or discussing protection? We can help with that, too.
              </p>
              {!slots.length && (
                <p>
                  No online times are available. Call{" "}
                  <a href="tel:+12525410040">252-541-0040</a> to arrange a
                  visit.
                </p>
              )}
              <div className="dm-chat-slots">
                {slots.map((s) => (
                  <button
                    key={s.starts_at}
                    className={
                      selected?.starts_at === s.starts_at ? "selected" : ""
                    }
                    onClick={() => setSelected(s)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {selected && (
                <div className="dm-chat-confirm">
                  <strong>{selected.label}</strong>
                  <span>Drive Max · 6210 Old US 70 West</span>
                  <button
                    className="dm-chat-primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await post({
                          action: "book",
                          starts_at: selected.starts_at,
                          confirmed: true,
                        });
                        setScreen("chat");
                      })
                    }
                  >
                    {busy ? "Confirming…" : "Confirm appointment"}
                    <Check size={17} />
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="dm-chat-error" role="alert">
              {error}
            </div>
          )}
          {screen === "chat" &&
            (conversation?.state === "closed" ? (
              <div className="dm-chat-ended">
                <button
                  className="dm-chat-primary"
                  disabled={busy}
                  onClick={start}
                >
                  Start a new conversation
                </button>
              </div>
            ) : (
              <>
                <div className="dm-chat-tools">
                  {!conversation?.contact_saved ? (
                    <button
                      disabled={busy || !conversation}
                      onClick={() => setScreen("contact")}
                    >
                      <UserRound size={14} /> Contact details
                    </button>
                  ) : (
                    <span>
                      <Check size={14} /> Details saved
                    </span>
                  )}
                  {config.booking_enabled && !conversation?.appointment && (
                    <button
                      disabled={busy || !conversation}
                      onClick={appointments}
                    >
                      <CalendarDays size={14} /> Choose a visit
                    </button>
                  )}
                  <button
                    disabled={
                      busy ||
                      !conversation ||
                      conversation.state === "human" ||
                      conversation.state === "waiting"
                    }
                    onClick={() =>
                      act(async () => {
                        await post({ action: "handoff" });
                      })
                    }
                  >
                    Talk to the team
                  </button>
                </div>
                <form
                  className="dm-chat-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <textarea
                    ref={messageInput}
                    aria-label="Your message"
                    placeholder="What can we help with?"
                    maxLength={2000}
                    rows={1}
                    value={draft}
                    disabled={busy || conversation?.busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={busy || conversation?.busy || !draft.trim()}
                  >
                    <ArrowUp size={20} />
                  </button>
                </form>
              </>
            ))}
          <footer className="dm-chat-footer">
            <span>
              AI-assisted. Chats are saved.{" "}
              <a href="/privacy-policy">Privacy</a>
            </span>
            <a href="tel:+12525410040" aria-label="Call Drive Max">
              <Phone size={13} /> Call
            </a>
          </footer>
        </div>
      )}
    </div>
  );
}
