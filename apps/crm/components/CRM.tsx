"use client";
import { useState, useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  DoorOpen,
  CalendarDays,
  FileText,
  Car,
  MessageSquare,
  Settings,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  ArrowUpRight,
  ArrowRight,
  Clock,
  Check,
  Phone,
  Mail,
  StickyNote,
  LogOut,
  CheckCircle2,
  Download,
  Printer,
  Menu,
  X,
  ShieldCheck,
  Database,
  Link2,
  CalendarCheck,
  Gift,
  Target,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Task,
  type Quote,
  type QuoteValues,
  type Command,
  opportunityOpen,
  opportunityCustomer,
  dayKey,
  addDays,
  addMonths,
  isOpenTask,
  canManage,
  myStaffId,
  visibleTasks,
  money,
  fullMoney,
  quoteMath,
  defaultQuote,
  demoCommand,
} from "../lib/model";
import { Avatar, Badge, Modal, Empty, SectionTitle, Go } from "./ui";
import { CustomerProfile } from "./CustomerProfile";
import { CustomerForm } from "./CustomerForm";
import { InventoryView, InventoryForm } from "./Inventory";
import { Desking } from "./Desking";
import { PriceQuotePrint } from "./PriceQuotePrint";
import { TeamSettings } from "./TeamSettings";
import { ConversationsInbox } from "./ConversationsInbox";
import { CustomerSearch } from "./CustomerSearch";
import { Accounting } from "./Accounting";
import { TradeIntake } from "./TradeIntake";
import { seedOperations } from "../lib/operations-demo";
import { Showroom, visitStatus } from "./Showroom";
import { type InventoryVehicle, vehicleName } from "../lib/vehicles";
import { signOut } from "../app/login/actions";

type View =
  | "Overview"
  | "Customers"
  | "Inventory"
  | "Showroom"
  | "Planner"
  | "Desking"
  | "Appraisals"
  | "Trade-ins"
  | "Accounting"
  | "Conversations"
  | "Workspace";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Customers", icon: Users },
  { name: "Inventory", icon: Car },
  { name: "Trade-ins", icon: RefreshCw },
  { name: "Accounting", icon: TrendingUp },
  { name: "Showroom", icon: DoorOpen },
  { name: "Planner", icon: CalendarDays },
  { name: "Desking", icon: FileText },
  { name: "Appraisals", icon: Car },
  { name: "Conversations", icon: MessageSquare },
] as const;
const time = (d: string) =>
  new Date(d).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
const dateLabel = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const taskLabel = (t: Task) => t.kind.replaceAll("_", " ");
export default function CRM({
  initial,
  demo,
}: {
  initial: Workspace;
  demo: boolean;
}) {
  const [ws, setWs] = useState(() =>
      demo ? seedOperations(initial) : initial,
    ),
    [view, setView] = useState<View>("Overview"),
    [search, setSearch] = useState(""),
    [stage, setStage] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [selectedOpp, setSelectedOpp] = useState<string | null>(null),
    [profileTab, setProfileTab] = useState<
      "Activity" | "Details" | "Desking" | "Texts" | "Emails"
    >("Activity"),
    [modal, setModal] = useState<
      "customer" | "task" | "call" | "sold" | "inventory" | null
    >(null),
    [edit, setEdit] = useState<Customer | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [taskScope, setTaskScope] = useState("all"),
    [planDate, setPlanDate] = useState(dayKey()),
    [planMode, setPlanMode] = useState<"Day" | "Week" | "Month">("Week"),
    [mobileNav, setMobileNav] = useState(false),
    [printData, setPrintData] = useState<{
      customer: Customer;
      quote?: Quote;
      pack?: boolean;
    } | null>(null);
  const [inventoryEdit, setInventoryEdit] = useState<InventoryVehicle | null>(
    null,
  );
  const today = dayKey(),
    customer = ws.customers.find((c) => c.id === selected),
    openTasks = visibleTasks(ws)
      .filter(isOpenTask)
      .filter(
        (t) =>
          !canManage(ws.member.role) ||
          taskScope === "all" ||
          (taskScope === "unassigned"
            ? !t.assigned_to
            : t.assigned_to === taskScope),
      ),
    todayVisits = ws.visits.filter((v) => dayKey(v.arrived_at) === today),
    overdue = openTasks.filter((t) => t.due_date < today),
    soldMonth = ws.opportunities.filter((c) =>
      c.sold_on?.startsWith(today.slice(0, 7)),
    ),
    active = ws.visits.filter((v) => !v.departed_at);
  const findCustomer = (id: string | null) =>
    ws.customers.find((c) => c.id === id);
  function navigate(v: View) {
    setStage("all");
    setView(v);
    setMobileNav(false);
    setSearch("");
  }
  function openCustomer(c: Customer, opportunityId: string | null = null) {
    setSelectedOpp(opportunityId);
    setSelected(c.id);
    setProfileTab("Activity");
    setNote("");
    setError("");
  }
  async function run(command: Command, message = "Saved") {
    setBusy(true);
    setError("");
    try {
      let id: string | undefined;
      if (demo) {
        const next = demoCommand(ws, command);
        setWs(next);
        if (command.type === "create_customer") id = next.customers[0].id;
        if (command.type === "create_opportunity")
          id = next.opportunities[0].id;
        if (
          command.type === "update_opportunity" ||
          command.type === "close_opportunity"
        )
          id = command.id;
        if (command.type === "save_inventory")
          id = command.id ?? next.inventory[0].id;
      } else {
        const r = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setWs(data.workspace);
        id = data.id;
      }
      setToast(message);
      setTimeout(() => setToast(""), 4000);
      return { ok: true, id };
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (demo) {
      setToast("Demo workspace · sample information");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (!r.ok)
        throw Error(
          "Could not refresh. Please sign in again if your session expired.",
        );
      setWs(await r.json());
      setToast("Workspace refreshed");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(ws, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `drive-max-crm-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function print(customer: Customer, quote?: Quote, pack = false) {
    setPrintData({ customer, quote, pack });
    setTimeout(() => window.print(), 80);
  }
  const currentOpportunity = (id: string) =>
    ws.opportunities.find((o) => o.customer_id === id && opportunityOpen(o));
  const taskRow = (t: Task) => {
    const c = findCustomer(t.customer_id);
    return (
      <div className="task-row" key={t.id}>
        <button
          className="task-check"
          disabled={busy}
          aria-label={`Complete ${t.title}`}
          onClick={() =>
            run({ type: "complete_task", id: t.id }, "Task completed")
          }
        >
          <Check size={13} />
        </button>
        <button
          className="task-content"
          disabled={!c}
          onClick={() => c && openCustomer(c, t.opportunity_id ?? null)}
        >
          <strong>{t.title}</strong>
          <span>
            {c?.name ?? "Dealership task"} <i>·</i> {taskLabel(t)} <i>·</i>{" "}
            {ws.staff.find((m) => m.id === t.assigned_to)?.name ?? "Unassigned"}
          </span>
        </button>
        <span className={`task-date ${t.due_date < today ? "late" : ""}`}>
          {t.due_date < today
            ? "Overdue"
            : t.due_date === today
              ? "Today"
              : dateLabel(t.due_date)}
        </span>
      </div>
    );
  };
  const visitCard = (v: Workspace["visits"][number]) => {
    const c = findCustomer(v.customer_id);
    if (!c) return null;
    const opportunity = ws.opportunities.find((o) => o.id === v.opportunity_id);
    const inventory =
      opportunity && opportunityOpen(opportunity)
        ? ws.inventory.find((i) => i.id === opportunity.inventory_id)
        : null;
    return (
      <article className={`visit-card visit-${visitStatus(v)}`} key={v.id}>
        <div className="visit-top">
          <Avatar name={c.name} />
          <div>
            <button
              className="name-button"
              onClick={() => openCustomer(c, v.opportunity_id ?? null)}
            >
              {c.name}
            </button>
            <span>{c.source}</span>
          </div>
          <Badge value={visitStatus(v)} />
        </div>
        <div className="visit-vehicle">
          <Car size={17} />
          <span>
            {inventory
              ? vehicleName(inventory)
              : opportunity?.vehicle_interest || "Vehicle to be selected"}
          </span>
        </div>
        <div className="visit-times">
          <span>
            <Clock size={13} />
            Arrived {time(v.arrived_at)}
          </span>
          <span>
            {v.departed_at ? "Left " + time(v.departed_at) : "Still here"}
          </span>
        </div>
        <div className="visit-actions">
          <button
            className="btn small"
            onClick={() => openCustomer(c, v.opportunity_id ?? null)}
          >
            Open profile
            <ArrowUpRight size={13} />
          </button>
          {!v.departed_at && (
            <button
              className="btn small end-visit"
              disabled={busy}
              onClick={() =>
                run(
                  { type: "check_out", id: v.id },
                  "Visit ended. Customer marked left.",
                )
              }
            >
              <LogOut size={14} />
              End visit
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <>
      <div className="app-shell">
        {mobileNav && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
          <div className="brand">
            <img src="/drive-max-logo.webp" alt="Drive Max Used Cars" />
            <span>DEALERSHIP WORKSPACE</span>
          </div>
          <div className="dealership-switch">
            <span className="dealer-icon">DM</span>
            <div>
              <strong>Drive Max</strong>
              <small>New Bern, North Carolina</small>
            </div>
            <ShieldCheck size={16} />
          </div>
          <div className="nav-label">YOUR SALES DAY</div>
          <nav aria-label="Main navigation">
            {nav
              .filter(
                (n) => n.name !== "Trade-ins" || canManage(ws.member.role),
              )
              .map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  className={view === name ? "nav-item active" : "nav-item"}
                  onClick={() => navigate(name)}
                >
                  <Icon size={19} />
                  <span>{name}</span>
                  {name === "Showroom" && active.length > 0 && (
                    <b>{active.length}</b>
                  )}
                  {name === "Planner" && overdue.length > 0 && (
                    <span className="nav-dot" />
                  )}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="pulse-dot" />
              <div>
                <strong>
                  {demo
                    ? "Explore your next chapter"
                    : "Your dealership, connected"}
                </strong>
                <p>
                  {demo
                    ? "Try the workflow with sample customers."
                    : "Every relationship has a next step."}
                </p>
              </div>
            </div>
            <button
              className={view === "Workspace" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("Workspace")}
            >
              <Settings size={18} />
              Settings
            </button>
            <div className="sidebar-user">
              <Avatar name={ws.member.name} size="small" />
              <div>
                <strong>{ws.member.name}</strong>
                <small>
                  {demo
                    ? "Demo workspace"
                    : ws.member.role === "sales"
                      ? "Salesperson"
                      : ws.member.role === "manager"
                        ? "Manager"
                        : "Dealership owner"}
                </small>
              </div>
              {demo ? (
                <a href="/login" aria-label="Sign in">
                  <LogOut size={17} />
                </a>
              ) : (
                <form action={signOut}>
                  <button aria-label="Sign out" type="submit">
                    <LogOut size={17} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button
              className="mobile-menu icon-btn"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumb">
              Workspace
              <ChevronRight size={13} />
              <strong>{view}</strong>
            </div>
            <div className="topbar-actions">
              <label className="global-search">
                <Search size={16} />
                <input
                  aria-label="Search customers"
                  placeholder="Search customers…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setView("Customers");
                  }}
                />
              </label>
              <button
                className="icon-btn refresh-btn"
                aria-label="Refresh workspace"
                onClick={refresh}
                disabled={busy}
              >
                <RefreshCw size={17} />
              </button>
              <span className="top-avatar">
                <Avatar name={ws.member.name} size="small" />
              </span>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <span>
                <span className="demo-pill">DEMO</span>Sample customers. Changes
                reset when you refresh.
              </span>
              <a href="/login">
                Open your live workspace
                <ArrowRight size={13} />
              </a>
            </div>
          )}
          <main className="content">
            {error && (
              <div className="error-notice" role="alert">
                {error}
                <button onClick={() => setError("")} aria-label="Dismiss error">
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {view === "Overview"
                    ? new Date(today + "T12:00:00Z").toLocaleDateString(
                        "en-US",
                        { weekday: "long", month: "long", day: "numeric" },
                      )
                    : "DRIVE MAX CRM"}
                </div>
                <h1>
                  {view === "Overview"
                    ? `Good to see you, ${ws.member.name.split(" ")[0]}.`
                    : view === "Workspace"
                      ? "Made for your dealership."
                      : view}
                </h1>
                <p>
                  {
                    {
                      Overview:
                        "Your sales day, in focus. Let’s move a few opportunities forward.",
                      Inventory:
                        "Your stock, your numbers, ready for the next conversation.",
                      Customers:
                        "Know the person. Remember the conversation. Find the next step.",
                      Showroom:
                        "Every visit counts. See who’s here and how their visit went.",
                      Planner:
                        "A thoughtful follow-up starts with a clear plan.",
                      Desking:
                        "Build the proposal. Keep the history. Move the deal forward.",
                      Appraisals:
                        "Keep your trade conversations and working values together.",
                      "Trade-ins":
                        "Receive, prepare, and route every trade to retail or wholesale.",
                      Accounting:
                        "Your inventory investment, deal profit, and team earnings.",
                      Conversations:
                        "One place for the conversation, from first hello to follow-up.",
                      Workspace:
                        "A focused foundation, with room for your next chapter.",
                    }[view]
                  }
                </p>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  if (view === "Inventory") {
                    setInventoryEdit(null);
                    setModal("inventory");
                  } else {
                    setEdit(null);
                    setModal("customer");
                  }
                }}
              >
                <Plus size={17} />
                {view === "Inventory" ? "Add vehicle" : "Add customer"}
              </button>
            </div>
            {(view === "Overview" || view === "Planner") && (
              <div className="task-scope">
                <span>
                  {canManage(ws.member.role)
                    ? "Team follow-up"
                    : "Your assigned follow-up"}
                </span>
                {canManage(ws.member.role) && (
                  <label>
                    Show tasks for
                    <select
                      aria-label="Task owner filter"
                      value={taskScope}
                      onChange={(e) => setTaskScope(e.target.value)}
                    >
                      <option value="all">Entire team</option>
                      <option value="unassigned">Unassigned</option>
                      {ws.staff.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.id === myStaffId(ws) ? " (me)" : ""}
                          {!m.active ? " (inactive)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {view === "Overview" && (
              <>
                <div className="stat-grid">
                  <Stat
                    title="In the showroom"
                    value={active.length}
                    sub={`${todayVisits.length} total visits today`}
                    icon={<DoorOpen />}
                    color="red"
                    onClick={() => navigate("Showroom")}
                  />
                  <Stat
                    title="Follow-ups due"
                    value={openTasks.filter((t) => t.due_date <= today).length}
                    sub={
                      overdue.length
                        ? `${overdue.length} need a little attention`
                        : "You’re up to date"
                    }
                    icon={<CalendarCheck />}
                    color="amber"
                    onClick={() => navigate("Planner")}
                  />
                  <Stat
                    title="Active customers"
                    value={
                      ws.customers.filter((c) =>
                        ws.opportunities.some(
                          (o) => o.customer_id === c.id && opportunityOpen(o),
                        ),
                      ).length
                    }
                    sub="Open opportunities in your book"
                    icon={<Users />}
                    color="blue"
                    onClick={() => navigate("Customers")}
                  />
                  <Stat
                    title="Sold this month"
                    value={soldMonth.length}
                    sub="Relationships worth celebrating"
                    icon={<CheckCircle2 />}
                    color="green"
                    onClick={() => {
                      navigate("Customers");
                      setStage("sold");
                    }}
                  />
                </div>
                <div className="dashboard-grid">
                  <section className="panel">
                    <SectionTitle
                      title="Your next moves"
                      subtitle="The conversations that deserve your attention."
                      action={
                        <Go onClick={() => navigate("Planner")}>
                          View planner
                        </Go>
                      }
                    />
                    <div className="panel-tabs">
                      <span className="selected">
                        Due & overdue{" "}
                        <b>
                          {openTasks.filter((t) => t.due_date <= today).length}
                        </b>
                      </span>
                      <span>Keep the momentum going</span>
                    </div>
                    <div className="task-list">
                      {openTasks
                        .filter((t) => t.due_date <= today)
                        .sort((a, b) => a.due_date.localeCompare(b.due_date))
                        .slice(0, 5)
                        .map(taskRow)}
                      {!openTasks.some((t) => t.due_date <= today) && (
                        <Empty
                          title="A clear runway."
                          body="You’re caught up. Add a task or plan your next conversation."
                          action={
                            <button
                              className="btn small"
                              onClick={() => setModal("task")}
                            >
                              Plan a follow-up
                            </button>
                          }
                        />
                      )}
                    </div>
                  </section>
                  <section className="momentum-card">
                    <div className="eyebrow">
                      RELATIONSHIPS, NOT JUST RECORDS
                    </div>
                    <h2>
                      Every customer.
                      <br />A next step.
                    </h2>
                    <p>
                      A great experience carries on long after the keys change
                      hands.
                    </p>
                    <div className="momentum-number">
                      {
                        openTasks.filter((t) =>
                          ["birthday", "anniversary", "sold_followup"].includes(
                            t.kind,
                          ),
                        ).length
                      }
                      <span>
                        relationship reminders
                        <br />
                        on your calendar
                      </span>
                    </div>
                    <button onClick={() => navigate("Planner")}>
                      See what’s coming up
                      <ArrowUpRight size={18} />
                    </button>
                    <div className="decor-rings" />
                  </section>
                </div>
                <section className="panel showroom-preview">
                  <SectionTitle
                    title="On the floor"
                    subtitle="A live view of the people in your showroom."
                    action={
                      <Go onClick={() => navigate("Showroom")}>
                        Open showroom
                      </Go>
                    }
                  />
                  {active.length ? (
                    <div className="visit-grid">
                      {active.slice(0, 3).map(visitCard)}
                    </div>
                  ) : (
                    <Empty
                      title="Ready for your next visitor."
                      body="Check a customer in from their profile when they arrive."
                      action={
                        <button
                          className="btn small"
                          onClick={() => navigate("Customers")}
                        >
                          Open customers
                        </button>
                      }
                    />
                  )}
                </section>
                <div className="dashboard-bottom">
                  <section className="panel">
                    <SectionTitle
                      title="Opportunity snapshot"
                      subtitle="A little clarity on where conversations stand."
                    />
                    {(["new", "working", "appointment", "sold"] as const).map(
                      (s) => (
                        <button
                          className="pipeline-row"
                          key={s}
                          onClick={() => {
                            navigate("Customers");
                            setStage(s);
                          }}
                        >
                          <Badge value={s} />
                          <span className="pipeline-track">
                            <span
                              className={s}
                              style={{
                                width: `${ws.opportunities.length ? Math.max(3, (ws.opportunities.filter((o) => o.status === s).length / ws.opportunities.length) * 100) : 0}%`,
                              }}
                            />
                          </span>
                          <strong>
                            {
                              ws.opportunities.filter((o) => o.status === s)
                                .length
                            }
                          </strong>
                        </button>
                      ),
                    )}
                  </section>
                  <section className="panel">
                    <SectionTitle
                      title="Recent activity"
                      subtitle="The latest moments across your customer book."
                    />
                    <div className="recent-list">
                      {ws.activities
                        .slice()
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )
                        .slice(0, 3)
                        .map((a) => (
                          <button
                            key={a.id}
                            onClick={() => {
                              const c = findCustomer(a.customer_id);
                              if (c) openCustomer(c);
                            }}
                          >
                            <span className="activity-icon">
                              {a.kind === "call" ? (
                                <Phone size={15} />
                              ) : (
                                <StickyNote size={15} />
                              )}
                            </span>
                            <div>
                              <strong>
                                {findCustomer(a.customer_id)?.name}
                              </strong>
                              <p>{a.body}</p>
                              <small>
                                {dateLabel(dayKey(a.created_at))} ·{" "}
                                {time(a.created_at)}
                              </small>
                            </div>
                          </button>
                        ))}
                      {!ws.activities.length && (
                        <p className="muted-copy">
                          Your team’s activity will appear here as you work.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
            {view === "Customers" && (
              <CustomerSearch
                ws={ws}
                query={search}
                initialStatus={stage}
                onOpen={openCustomer}
              />
            )}
            {view === "Accounting" && (
              <Accounting ws={ws} run={run} busy={busy} />
            )}
            {view === "Trade-ins" && (
              <TradeIntake
                ws={ws}
                run={run}
                busy={busy}
                onCustomer={(id, opp) => {
                  const c = findCustomer(id);
                  if (c) openCustomer(c, opp);
                }}
              />
            )}
            {view === "Inventory" && (
              <InventoryView
                inventory={ws.inventory}
                onAdd={() => {
                  setInventoryEdit(null);
                  setModal("inventory");
                }}
                onEdit={(v) => {
                  setInventoryEdit(v);
                  setModal("inventory");
                }}
              />
            )}
            {view === "Showroom" && (
              <Showroom
                visits={ws.visits}
                card={visitCard}
                onFindCustomer={() => navigate("Customers")}
              />
            )}
            {view === "Planner" && (
              <>
                <div className="view-controls">
                  <div className="date-control">
                    <button
                      aria-label="Previous period"
                      onClick={() =>
                        setPlanDate(
                          planMode === "Month"
                            ? addMonths(planDate, -1)
                            : addDays(planDate, planMode === "Day" ? -1 : -7),
                        )
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <input
                      aria-label="Planner date"
                      type="date"
                      value={planDate}
                      onChange={(e) =>
                        e.target.value && setPlanDate(e.target.value)
                      }
                    />
                    <button
                      aria-label="Next period"
                      onClick={() =>
                        setPlanDate(
                          planMode === "Month"
                            ? addMonths(planDate, 1)
                            : addDays(planDate, planMode === "Day" ? 1 : 7),
                        )
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                    <button onClick={() => setPlanDate(today)}>Today</button>
                  </div>
                  <div className="planner-actions">
                    <div className="segmented">
                      {(["Day", "Week", "Month"] as const).map((m) => (
                        <button
                          key={m}
                          className={planMode === m ? "chosen" : ""}
                          onClick={() => setPlanMode(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <button className="btn" onClick={() => setModal("task")}>
                      <Plus size={15} />
                      Add task
                    </button>
                  </div>
                </div>
                {overdue.length > 0 && (
                  <section className="panel overdue-panel">
                    <SectionTitle
                      title={`${overdue.length} overdue ${overdue.length === 1 ? "follow-up" : "follow-ups"}`}
                      subtitle="A small nudge can start the conversation again."
                    />
                    {overdue.map(taskRow)}
                  </section>
                )}
                <Planner
                  mode={planMode}
                  date={planDate}
                  today={today}
                  tasks={openTasks}
                  taskRow={taskRow}
                  open={(t) => {
                    const c = findCustomer(t.customer_id);
                    if (c) openCustomer(c);
                  }}
                  onDay={(d) => {
                    setPlanDate(d);
                    setPlanMode("Day");
                  }}
                />
              </>
            )}
            {view === "Desking" && (
              <section className="panel">
                <SectionTitle
                  title="Saved proposals"
                  subtitle="Each saved quote keeps its own version of the numbers."
                />
                {ws.quotes.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Customer / vehicle</th>
                          <th>Sale price</th>
                          <th>Estimated balance</th>
                          <th>Created</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {ws.quotes
                          .slice()
                          .sort((a, b) =>
                            b.created_at.localeCompare(a.created_at),
                          )
                          .map((q) => {
                            const c = findCustomer(q.customer_id);
                            return (
                              <tr key={q.id}>
                                <td>
                                  <button
                                    className="name-button"
                                    onClick={() => {
                                      if (c) {
                                        openCustomer(
                                          c,
                                          q.opportunity_id ?? null,
                                        );
                                        setProfileTab("Desking");
                                      }
                                    }}
                                  >
                                    {c?.name}
                                  </button>
                                  <small className="subtext">{q.vehicle}</small>
                                </td>
                                <td>{money(q.values.price)}</td>
                                <td>{money(quoteMath(q.values).balance)}</td>
                                <td>{dateLabel(dayKey(q.created_at))}</td>
                                <td>
                                  <button
                                    className="btn small"
                                    onClick={() => c && print(c, q)}
                                  >
                                    <Printer size={14} />
                                    Print quote
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="A good proposal starts with a customer."
                    body="Open a customer profile, then choose Desking to build your first proposal."
                    action={
                      <button
                        className="btn"
                        onClick={() => navigate("Customers")}
                      >
                        Open customers
                      </button>
                    }
                  />
                )}
                <div className="panel-foot">
                  NC highway-use tax is calculated in Desking. Review the
                  selected payment option, taxes, and fees before delivery.
                </div>
              </section>
            )}
            {view === "Appraisals" && (
              <>
                <section className="info-banner">
                  <Car size={23} />
                  <div>
                    <strong>Your working trade desk</strong>
                    <p>
                      Record trade VIN, mileage, allowance, ACV, and payoff in
                      the customer profile. VIN decoding is ready; live book
                      values are not connected.
                    </p>
                  </div>
                </section>
                <div className="visit-grid full">
                  {ws.opportunities
                    .filter((o) => o.trade_vehicle)
                    .map((o) => {
                      const original = ws.customers.find(
                        (c) => c.id === o.customer_id,
                      );
                      if (!original) return null;
                      const c = opportunityCustomer(original, o);
                      const q = ws.quotes
                        .filter((q) => q.opportunity_id === o.id)
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )[0];
                      return (
                        <section className="panel trade-card" key={o.id}>
                          <div className="trade-icon">
                            <Car size={26} />
                          </div>
                          <h3>{c.trade_vehicle}</h3>
                          <p>
                            {c.name} · {o.title} <Badge value={o.status} />
                          </p>
                          <div className="trade-values">
                            <div>
                              <small>Working ACV</small>
                              <strong>
                                {c.trade
                                  ? money(c.trade.acv)
                                  : q
                                    ? money(q.values.acv)
                                    : "—"}
                              </strong>
                            </div>
                            <div>
                              <small>Est. reconditioning</small>
                              <strong>{q ? money(q.values.recon) : "—"}</strong>
                            </div>
                          </div>
                          <button
                            className="btn"
                            onClick={() => {
                              openCustomer(original, o.id);
                              setProfileTab("Desking");
                            }}
                          >
                            Open trade worksheet
                            <ArrowUpRight size={14} />
                          </button>
                        </section>
                      );
                    })}
                </div>
                {!ws.opportunities.some((o) => o.trade_vehicle) && (
                  <section className="panel">
                    <Empty
                      title="Room for the next trade."
                      body="Add a trade-in to a customer profile to start a working appraisal."
                    />
                  </section>
                )}
              </>
            )}
            {view === "Conversations" && (
              <ConversationsInbox
                ws={ws}
                query={search}
                onOpen={(c, channel) => {
                  openCustomer(c);
                  setProfileTab(channel === "sms" ? "Texts" : "Emails");
                }}
              />
            )}
            {view === "Workspace" && (
              <>
                <TeamSettings
                  ws={ws}
                  busy={busy}
                  error={error}
                  demo={demo}
                  run={run}
                />
                <div className="settings-grid">
                  <section className="panel">
                    <SectionTitle
                      title="Your dealership"
                      subtitle="The first workspace in a foundation built to grow."
                    />
                    <dl className="settings-list">
                      <dt>Name</dt>
                      <dd>{ws.org.name}</dd>
                      <dt>Account</dt>
                      <dd>{ws.member.name}</dd>
                      <dt>Role</dt>
                      <dd className="capitalize">{ws.member.role}</dd>
                      <dt>Timezone</dt>
                      <dd>Eastern Time</dd>
                      <dt>Environment</dt>
                      <dd>
                        <Badge value={demo ? "demo" : "live"} />
                      </dd>
                    </dl>
                  </section>
                  <section className="panel">
                    <SectionTitle
                      title="Your data stays yours"
                      subtitle="Download a copy of your workspace whenever you need it."
                    />
                    <p className="muted-copy">
                      Customer profiles, opportunities, inventory, trades,
                      visits, notes, tasks, and saved proposals are included in
                      your export.
                    </p>
                    <button className="btn" onClick={exportData}>
                      <Download size={16} />
                      Export workspace
                    </button>
                    <div className="security-line">
                      <ShieldCheck size={16} />
                      Server-checked dealership access
                    </div>
                    <div className="security-line">
                      <Database size={16} />
                      {demo
                        ? "Sample data held only in this tab"
                        : "Saved in dedicated CRM tables"}
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <SectionTitle title="What’s ready — and what’s next" />
                  <div className="roadmap-grid">
                    <div>
                      <CheckCircle2 />
                      <h3>The working foundation</h3>
                      <p>
                        Customer profiles, inventory, VIN decoding, showroom
                        visits, planner, desking, trade worksheets, and
                        printable deal summaries.
                      </p>
                    </div>
                    <div>
                      <Link2 />
                      <h3>Connected conversations</h3>
                      <p>
                        Email, SMS, website lead intake, and automatic call
                        history are the next integration stage.
                      </p>
                    </div>
                    <div>
                      <Users />
                      <h3>A product for more dealers</h3>
                      <p>
                        Dealership membership and data boundaries are in place.
                        Team roles and task assignment are ready. Self-service
                        dealer onboarding and billing come later.
                      </p>
                    </div>
                  </div>
                </section>
              </>
            )}
            <footer className="workspace-footer">
              <span>
                DRIVE MAX CRM <i>·</i> Built around relationships.
              </span>
              <span>
                {demo ? "Interactive demo" : "Foundation release"}{" "}
                <span className="dot green" />
              </span>
            </footer>
          </main>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {customer && (
        <CustomerProfile
          key={customer.id}
          ws={ws}
          customer={customer}
          demo={demo}
          busy={busy}
          error={error}
          run={run}
          onClose={() => setSelected(null)}
          onPrintQuote={(c, q) => print(c, q)}
          initialTab={profileTab}
          initialOpportunityId={selectedOpp}
        />
      )}
      {modal === "customer" && (
        <Modal
          title={edit ? "Edit customer" : "Start a new relationship"}
          subtitle="Customer identification, contact information, and co-buyer."
          onClose={() => {
            setModal(null);
            setEdit(null);
          }}
          wide
        >
          <CustomerForm
            existing={edit}
            busy={busy}
            error={error}
            submit={async (data) => {
              const result = await run(
                edit
                  ? { type: "update_customer", id: edit.id, customer: data }
                  : { type: "create_customer", customer: data },
                edit ? "Profile updated" : "Customer added",
              );
              if (result.ok) {
                setModal(null);
                setEdit(null);
                if (result.id && !edit) {
                  setSelected(result.id);
                  setProfileTab("Activity");
                  setNote("");
                }
              }
            }}
          />
        </Modal>
      )}
      {modal === "inventory" && (
        <Modal
          title={
            inventoryEdit
              ? "Edit inventory vehicle"
              : "Add an inventory vehicle"
          }
          subtitle="Enter it once. Bring it into any customer’s deal."
          onClose={() => {
            setModal(null);
            setInventoryEdit(null);
          }}
          wide
        >
          <InventoryForm
            existing={inventoryEdit}
            busy={busy}
            error={error}
            demo={demo}
            submit={async (command) => {
              if (
                (
                  await run(
                    command,
                    inventoryEdit
                      ? "Inventory updated"
                      : "Vehicle added to inventory",
                  )
                ).ok
              ) {
                setModal(null);
                setInventoryEdit(null);
              }
            }}
          />
        </Modal>
      )}
      {modal === "task" && (
        <Modal
          title="Plan the next step"
          subtitle="Put a little intention into the next conversation."
          onClose={() => setModal(null)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const result = await run(
                {
                  type: "create_task",
                  ...(canManage(ws.member.role) &&
                  f.get("assigned_to") !== "auto"
                    ? { assigned_to: String(f.get("assigned_to")) || null }
                    : {}),
                  customer_id: String(f.get("customer")) || null,
                  title: String(f.get("title")),
                  due_date: String(f.get("date")),
                  kind: String(f.get("kind")) as "task",
                  channel: String(f.get("channel") || "call") as "call",
                },
                "Task added",
              );
              if (result.ok) setModal(null);
            }}
          >
            <label>
              Follow-up action
              <select name="channel" defaultValue="call">
                <option value="call">Call</option>
                <option value="sms">Text message</option>
                <option value="email">Email</option>
                <option value="task">General task</option>
              </select>
            </label>
            {canManage(ws.member.role) && (
              <label>
                Assigned to
                <select name="assigned_to" defaultValue="auto">
                  <option value="auto">
                    Use customer’s assigned salesperson
                  </option>
                  <option value="">Unassigned · manager queue</option>
                  {ws.staff
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Task title
              <input
                name="title"
                placeholder="What’s the next step?"
                required
                minLength={2}
                maxLength={250}
              />
            </label>
            <label>
              Customer
              <select name="customer" defaultValue={customer?.id ?? ""}>
                <option value="">Dealership task</option>
                {ws.customers
                  .filter(
                    (c) =>
                      canManage(ws.member.role) ||
                      c.assigned_to === myStaffId(ws),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Due date
                <input
                  name="date"
                  type="date"
                  defaultValue={planDate}
                  required
                />
              </label>
              <label>
                Type
                <select name="kind">
                  <option value="task">Task</option>
                  <option value="appointment">Appointment</option>
                  <option value="unsold_followup">Unsold follow-up</option>
                  <option value="sold_followup">Sold follow-up</option>
                </select>
              </label>
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              Save task
            </button>
          </form>
        </Modal>
      )}
      {modal === "call" && customer && (
        <Modal
          title="Log a phone call"
          subtitle={customer.name}
          onClose={() => setModal(null)}
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
                      type: "add_activity",
                      customer_id: customer.id,
                      kind: "call",
                      body: `${f.get("direction")} · ${f.get("outcome")}\n${f.get("body")}`,
                    },
                    "Call logged",
                  )
                ).ok
              )
                setModal(null);
            }}
          >
            <div className="form-grid">
              <label>
                Direction
                <select name="direction">
                  <option>Outbound call</option>
                  <option>Inbound call</option>
                </select>
              </label>
              <label>
                Outcome
                <select name="outcome">
                  <option>Connected</option>
                  <option>Left voicemail</option>
                  <option>No answer</option>
                  <option>Wrong number</option>
                </select>
              </label>
            </div>
            <label>
              Call notes
              <textarea
                name="body"
                placeholder="What did you discuss? What happens next?"
                maxLength={7500}
              />
            </label>
            <p className="fine-print">
              This saves a call history entry. It does not place or record a
              call.
            </p>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              Save call log
            </button>
          </form>
        </Modal>
      )}
      {modal === "sold" && customer && (
        <Modal
          title="A new set of keys."
          subtitle={`Mark ${customer.name} as sold?`}
          onClose={() => setModal(null)}
        >
          <div className="modal-form">
            <p>
              This records today’s sale, closes unsold follow-up tasks, and adds
              2-day, 7-day, 30-day, and purchase anniversary reminders.
            </p>
            <p className="fine-print">
              Their showroom visit stays open until you select End visit. A
              linked CRM inventory vehicle will be marked sold.
            </p>
            {error && <p className="form-error">{error}</p>}
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (
                  (
                    await run(
                      { type: "mark_sold", customer_id: customer.id },
                      "Sold! Follow-up is planned.",
                    )
                  ).ok
                )
                  setModal(null);
              }}
            >
              <CheckCircle2 size={16} />
              Confirm sale
            </button>
          </div>
        </Modal>
      )}
      {printData && <PrintSheet data={printData} dealership={ws.org.name} />}
    </>
  );
}
function Stat({
  title,
  value,
  sub,
  icon,
  color,
  onClick,
}: {
  title: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
}) {
  return (
    <button className="stat-card" onClick={onClick}>
      <div>
        <span>{title}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <p>
        {sub}
        <ArrowUpRight size={14} />
      </p>
    </button>
  );
}
function Planner({
  mode,
  date,
  today,
  tasks,
  taskRow,
  open,
  onDay,
}: {
  mode: "Day" | "Week" | "Month";
  date: string;
  today: string;
  tasks: Task[];
  taskRow: (t: Task) => React.ReactNode;
  open: (t: Task) => void;
  onDay: (d: string) => void;
}) {
  const wd = new Date(date + "T12:00:00Z").getUTCDay(),
    start =
      mode === "Month"
        ? addDays(
            date.slice(0, 8) + "01",
            -new Date(date.slice(0, 8) + "01T12:00:00Z").getUTCDay(),
          )
        : addDays(date, -wd),
    days = Array.from({ length: mode === "Month" ? 42 : 7 }, (_, i) =>
      addDays(start, i),
    );
  if (mode === "Day")
    return (
      <section className="panel">
        <SectionTitle
          title={new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        />
        {tasks.filter((t) => t.due_date === date).map(taskRow)}
        {!tasks.some((t) => t.due_date === date) && (
          <Empty
            title="A little breathing room."
            body="No open tasks on this day. Add a follow-up or an appointment."
          />
        )}
      </section>
    );
  return (
    <section className={`panel calendar ${mode.toLowerCase()}`}>
      <div className="calendar-heading">
        <h2>
          {new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <span>
          {tasks.filter((t) => days.includes(t.due_date)).length} planned tasks
        </span>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div className="weekday" key={d}>
            {d}
          </div>
        ))}
        {days.map((d) => (
          <div
            className={`calendar-cell ${d === today ? "is-today" : ""} ${d.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""}`}
            key={d}
          >
            <button className="calendar-day" onClick={() => onDay(d)}>
              {Number(d.slice(8))}
            </button>
            {tasks
              .filter((t) => t.due_date === d)
              .map((t) => (
                <button
                  className={`calendar-task ${t.kind}`}
                  key={t.id}
                  onClick={() => (t.customer_id ? open(t) : onDay(d))}
                >
                  <span className="dot" />
                  {t.title}
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
function PrintSheet({
  data,
  dealership,
}: {
  data: { customer: Customer; quote?: Quote; pack?: boolean };
  dealership: string;
}) {
  const { customer: c, quote: q, pack } = data;
  if (q && !pack)
    return <PriceQuotePrint customer={c} quote={q} dealership={dealership} />;
  return (
    <section className="print-sheet">
      <header>
        <img src="/drive-max-logo.webp" alt="Drive Max" />
        <div>
          <h1>{pack ? "Preliminary deal summary" : "Vehicle price quote"}</h1>
          <p>
            {dealership} · {dateLabel(dayKey())}
          </p>
        </div>
      </header>
      <h2>{c.name}</h2>
      <p>
        {c.phone} · {c.email}
      </p>
      <dl>
        <dt>Vehicle</dt>
        <dd>{q?.vehicle || c.vehicle_interest || "To be selected"}</dd>
        {q?.vehicle_details?.vin && (
          <>
            <dt>Vehicle VIN</dt>
            <dd>{q.vehicle_details.vin}</dd>
          </>
        )}
        <dt>Trade-in</dt>
        <dd>
          {q?.snapshot_version === 1
            ? q.trade_snapshot?.description ||
              (q.trade_snapshot
                ? vehicleName(q.trade_snapshot)
                : "None recorded")
            : c.trade_vehicle || "None recorded"}
        </dd>
        {q?.trade_snapshot && (
          <>
            <dt>Trade VIN</dt>
            <dd>
              {q.trade_snapshot.vin} ·{" "}
              {q.trade_snapshot.mileage.toLocaleString()} miles
            </dd>
          </>
        )}
      </dl>
      {q && (
        <>
          <table>
            <tbody>
              {(
                [
                  ["price", "Selling price"],
                  ["docFee", "Document fee"],
                  ["addOns", "Taxable add-ons"],
                  ["serviceContract", "Service contract"],
                  ["otherTaxes", "Other taxes"],
                  ["tax", "Estimated tax"],
                  ["titleFee", "Title / registration"],
                  ["tradeAllowance", "Less trade allowance"],
                  ["payoff", "Trade payoff"],
                  ["downPayment", "Cash down"],
                ] as [keyof QuoteValues, string][]
              ).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{fullMoney(Number(q.values[k] ?? 0))}</td>
                </tr>
              ))}
              <tr>
                <th>Estimated balance</th>
                <th>{fullMoney(quoteMath(q.values).balance)}</th>
              </tr>
            </tbody>
          </table>
          <p>
            {q.values.mode === "cash"
              ? "Cash transaction. Financing example only:"
              : "Illustrative payment:"}{" "}
            {fullMoney(quoteMath(q.values).payment)} / month · {q.values.months}{" "}
            months · {q.values.apr}% APR · {q.values.daysToFirstPayment ?? 30}{" "}
            days to first payment. Includes{" "}
            {fullMoney(quoteMath(q.values).firstPeriodInterest)} estimated
            initial-period interest. Subject to lender terms.
          </p>
        </>
      )}
      {pack && (
        <>
          <h3>Deal folder checklist</h3>
          {[
            "Customer contact information verified",
            "Vehicle and VIN verified",
            "Trade title / payoff verified",
            "Insurance verified",
            "Buyer’s order reviewed",
            "Required disclosures reviewed",
            "Final contract and title documents completed",
            "Delivery and follow-up scheduled",
          ].map((t) => (
            <p className="print-check" key={t}>
              <span /> {t}
            </p>
          ))}
          <h3>Delivery notes</h3>
          <div className="writing-lines" />
        </>
      )}
      <footer>
        Preliminary worksheet only. Verify vehicle details, taxes, registration,
        payoff, and all figures. Financing is subject to lender approval. This
        document does not replace required contracts, disclosures, or title
        paperwork.
      </footer>
    </section>
  );
}
