"use client";
import { useState, useMemo, useEffect } from "react";
import { WorkToday } from "./WorkToday";
import { DocumentVault } from "./DocumentVault";
import { Appraisals } from "./Appraisals";
import { OverviewFunnel } from "./OverviewFunnel";
import { UserProfileSettings } from "./UserProfileSettings";
import { WorkflowSettings } from "./WorkflowSettings";
import { BuyerMatches } from "./BuyerMatches";
import { InventoryPreparation } from "./InventoryPreparation";
import { SalesReports } from "./SalesReports";
import { PushSettings } from "./PushSettings";
import {
  FolderLock,
  Bell,
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
  Calculator,
} from "lucide-react";
import {
  type Workspace,
  type Customer,
  type Task,
  type Quote,
  type PrintableQuote,
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
import { QuickQuote } from "./QuickQuote";
import { PriceQuotePrint } from "./PriceQuotePrint";
import { TeamSettings } from "./TeamSettings";
import { EmailSettingsPanel } from "./EmailSettings";
import { ConversationsInbox } from "./ConversationsInbox";
import {
  AppointmentDialog,
  AppointmentOverview,
  AppointmentRow,
} from "./Appointments";
import {
  appointmentsForRange,
  appointmentLocalParts,
  appointmentKinds,
  appointmentTime,
  type Appointment,
} from "../lib/appointments";
import { AttentionCenter, useAttention } from "./Attention";
import type { AttentionItem } from "../lib/attention";
import { TaskAction, MessageComposer, type Compose } from "./Communications";
import { CustomerSearch } from "./CustomerSearch";
import { Accounting } from "./Accounting";
import { TradeIntake } from "./TradeIntake";
import { seedSalesWorkspace } from "../lib/sales-work-demo";
import { seedOperations } from "../lib/operations-demo";
import { Showroom, visitStatus } from "./Showroom";
import { type InventoryVehicle, vehicleName } from "../lib/vehicles";
import { signOut } from "../app/login/actions";

type View =
  | "Work Today"
  | "Sales reports"
  | "Overview"
  | "Customers"
  | "Inventory"
  | "Showroom"
  | "Planner"
  | "Desking"
  | "Document Vault"
  | "Appraisals"
  | "Trade-ins"
  | "Accounting"
  | "Conversations"
  | "Workspace";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Showroom", icon: DoorOpen },
  { name: "Work Today", icon: CheckCircle2 },
  { name: "Customers", icon: Users },
  { name: "Desking", icon: FileText },
  { name: "Conversations", icon: MessageSquare },
  { name: "Planner", icon: CalendarDays },
  { name: "Inventory", icon: Car },
  { name: "Trade-ins", icon: RefreshCw },
  { name: "Appraisals", icon: Car },
  { name: "Document Vault", icon: FolderLock },
  { name: "Accounting", icon: TrendingUp },
  { name: "Sales reports", icon: Target },
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
      demo ? seedSalesWorkspace(seedOperations(initial)) : initial,
    ),
    [view, setView] = useState<View>("Overview"),
    [search, setSearch] = useState(""),
    [stage, setStage] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [selectedOpp, setSelectedOpp] = useState<string | null>(null),
    [profileTab, setProfileTab] = useState<
      "Activity" | "Details" | "Desking" | "Texts" | "Emails"
    >("Activity"),
    [appointmentDialog, setAppointmentDialog] = useState<
      Appointment | "new" | null
    >(null),
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
    [quickQuoteOpen, setQuickQuoteOpen] = useState(false),
    [printData, setPrintData] = useState<{
      customer: Customer | null;
      quote?: PrintableQuote;
      pack?: boolean;
    } | null>(null);
  const [inventoryEdit, setInventoryEdit] = useState<InventoryVehicle | null>(
    null,
  );
  const alerts = useAttention(ws, demo, busy);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("customer");
    if (id && initial.customers.some((c) => c.id === id)) {
      setSelected(id);
      setSelectedOpp(params.get("opportunity"));
      setProfileTab("Activity");
    } else if (params.get("view") === "work") setView("Work Today");
  }, [initial]);
  useEffect(() => {
    if (
      demo ||
      busy ||
      selected ||
      (view !== "Work Today" && view !== "Overview")
    )
      return;
    let canceled = false;
    const refreshQuietly = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (response.ok && !canceled) setWs(await response.json());
      } catch {
        /* Header refresh remains available. */
      }
    };
    const timer = setInterval(refreshQuietly, 60000);
    window.addEventListener("focus", refreshQuietly);
    return () => {
      canceled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refreshQuietly);
    };
  }, [demo, busy, selected, view]);
  const [attentionTask, setAttentionTask] = useState<Task | null>(null);
  const [attentionCompose, setAttentionCompose] = useState<{
    customer: Customer;
    compose: Compose;
  } | null>(null);
  const today = dayKey(),
    customer = ws.customers.find((c) => c.id === selected),
    openTasks = visibleTasks(ws)
      .filter(isOpenTask)
      .filter(
        (t) =>
          view !== "Planner" ||
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
  const plannedAppointments = appointmentsForRange(
    ws.appointments ?? [],
    "2000-01-01",
    "9999-12-31",
    canManage(ws.member.role) ? taskScope : (myStaffId(ws) ?? ""),
  );
  const findCustomer = (id: string | null) =>
    ws.customers.find((c) => c.id === id);
  function navigate(v: View) {
    setQuickQuoteOpen(false);
    setPrintData(null);
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
      let revision: number | undefined;
      if (demo) {
        const next = demoCommand(ws, command);
        setWs(next);
        if (command.type === "create_customer") id = next.customers[0].id;
        if (command.type === "convert_quick_quote")
          id = next.quick_quote_conversions?.[command.id]?.customer_id;
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
        if (command.type === "save_message")
          revision = data.workspace.messages?.find(
            (m: { id: string; revision: number }) => m.id === id,
          )?.revision;
      }
      setToast(message);
      setTimeout(() => setToast(""), 4000);
      return { ok: true, id, revision };
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }
  async function openAttention(item: AttentionItem) {
    setBusy(true);
    setError("");
    try {
      let current = ws;
      if (!demo) {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok)
          throw Error(
            "Could not load the latest customer activity. Refresh and try again.",
          );
        current = await response.json();
        setWs(current);
      }
      if (item.kind === "task") {
        const task = current.tasks.find(
          (t) => t.id === item.id && isOpenTask(t),
        );
        if (task) setAttentionTask(task);
        return;
      }
      const c = current.customers.find((c) => c.id === item.customer_id);
      if (c) {
        openCustomer(c, item.opportunity_id);
        setProfileTab(
          item.channel === "email"
            ? "Emails"
            : item.channel === "sms"
              ? "Texts"
              : "Activity",
        );
      }
    } catch (e) {
      setError((e as Error).message);
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
  function print(
    customer: Customer | null,
    quote?: PrintableQuote,
    pack = false,
  ) {
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
                  {demo ? "Explore your next chapter" : "Your daily workspace"}
                </strong>
                <p>
                  {demo
                    ? "Try the workflow with sample customers."
                    : "Appointments, deals and follow-up."}
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
              <strong>{view === "Workspace" ? "Settings" : view}</strong>
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
                className={`attention-bell ${alerts.feed.total ? "has-alerts" : ""}`}
                aria-label={`${alerts.feed.total} items need attention${alerts.error ? ". Alerts could not refresh" : ""}`}
                onClick={() => {
                  setSelected(null);
                  navigate("Overview");
                }}
              >
                <Bell size={18} />
                <span aria-live="polite">
                  {alerts.error ? "!" : alerts.feed.total}
                </span>
              </button>
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
            <div
              className={`page-heading ${view === "Overview" ? "overview-heading" : ""}`}
            >
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
                    ? `Good to see you, ${ws.member.name}.`
                    : view === "Workspace"
                      ? "Settings"
                      : view}
                </h1>
                <p>
                  {
                    {
                      Overview:
                        "Your sales day, in focus. Let’s move a few opportunities forward.",
                      "Work Today":
                        "The customers, appointments and deals that need your attention next.",
                      "Sales reports":
                        "See where opportunities progress and where the process needs attention.",
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
                      "Document Vault":
                        "Private paperwork, organized by customer and vehicle.",
                      Appraisals:
                        "Keep your trade conversations and working values together.",
                      "Trade-ins":
                        "Receive, prepare, and route every trade to retail or wholesale.",
                      Accounting:
                        "Your inventory investment, deal profit, and team earnings.",
                      Conversations:
                        "One place for the conversation, from first hello to follow-up.",
                      Workspace:
                        "Manage team access, dealership details and data exports.",
                    }[view]
                  }
                </p>
              </div>
              <div className="ops-actions">
                {view === "Desking" && !quickQuoteOpen && (
                  <button
                    className="btn primary"
                    onClick={() => {
                      setError("");
                      setQuickQuoteOpen(true);
                    }}
                  >
                    <Calculator size={17} />
                    Quick quote
                  </button>
                )}
                {!quickQuoteOpen &&
                  view !== "Workspace" &&
                  view !== "Document Vault" && (
                    <button
                      className={view === "Desking" ? "btn" : "btn primary"}
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
                  )}
              </div>
            </div>
            {view === "Planner" && (
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
            {view === "Work Today" && (
              <>
                <WorkToday
                  ws={ws}
                  onCustomer={openCustomer}
                  onTask={setAttentionTask}
                  onAppointment={setAppointmentDialog}
                  onEmail={(customer, opportunity_id) =>
                    setAttentionCompose({
                      customer,
                      compose: { channel: "email", opportunity_id },
                    })
                  }
                />
                <BuyerMatches
                  ws={ws}
                  run={run}
                  busy={busy}
                  onCustomer={openCustomer}
                />
              </>
            )}
            {view === "Sales reports" && <SalesReports ws={ws} />}
            {view === "Inventory" && (
              <InventoryPreparation ws={ws} run={run} busy={busy} />
            )}
            {view === "Overview" && (
              <div className="overview-dashboard">
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
                    onClick={() => {
                      navigate("Customers");
                      setStage("active");
                    }}
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
                <div className="overview-columns">
                  <div className="overview-column">
                    <AttentionCenter
                      feed={alerts.feed}
                      error={alerts.error}
                      busy={busy}
                      onOpen={openAttention}
                      onRefresh={alerts.reload}
                      onReview={(item) => {
                        if (item.kind !== "task")
                          void run(
                            {
                              type: "review_attention",
                              kind: item.kind,
                              id: item.id,
                            },
                            "Alert marked reviewed for you",
                          );
                      }}
                    />
                    <AppointmentOverview
                      ws={ws}
                      onSchedule={() => {
                        setError("");
                        setAppointmentDialog("new");
                      }}
                      onOpen={(a) => {
                        setError("");
                        setAppointmentDialog(a);
                      }}
                    />
                    <div className="overview-work">
                      <WorkToday
                        ws={ws}
                        compact
                        onCustomer={openCustomer}
                        onTask={setAttentionTask}
                        onAppointment={setAppointmentDialog}
                        onEmail={(customer, opportunity_id) =>
                          setAttentionCompose({
                            customer,
                            compose: { channel: "email", opportunity_id },
                          })
                        }
                      />
                      <button
                        className="text-btn work-open"
                        onClick={() => navigate("Work Today")}
                      >
                        Open all of Work Today <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="overview-column">
                    <section className="panel showroom-preview overview-floor">
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
                          {active.slice(0, 4).map(visitCard)}
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
                    <OverviewFunnel ws={ws} onCustomer={openCustomer} />
                    <section className="panel overview-recent">
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
                          .slice(0, 4)
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
                </div>
              </div>
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
                websiteInventory={ws.website_inventory}
                websiteConnected={alerts.feed.websiteInventory?.connected}
                onRefresh={refresh}
                busy={busy}
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
                    <button
                      className="btn primary"
                      onClick={() => {
                        setError("");
                        setAppointmentDialog("new");
                      }}
                    >
                      <CalendarDays size={15} />
                      Schedule appointment
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
                  appointments={plannedAppointments}
                  ws={ws}
                  onAppointment={(a) => {
                    setError("");
                    setAppointmentDialog(a);
                  }}
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
            {view === "Desking" && quickQuoteOpen && (
              <QuickQuote
                ws={ws}
                busy={busy}
                error={error}
                onClearError={() => {
                  setError("");
                  setPrintData(null);
                }}
                onClose={() => {
                  setQuickQuoteOpen(false);
                  setPrintData(null);
                  setError("");
                }}
                onPrint={(quote) => print(null, quote)}
                onCreate={async (command) => {
                  const result = await run(
                    command,
                    "Customer created · quick quote saved",
                  );
                  if (result.ok && result.id) {
                    setQuickQuoteOpen(false);
                    setPrintData(null);
                    setSelectedOpp(null);
                    setSelected(result.id);
                    setProfileTab("Desking");
                    setNote("");
                  }
                  return result;
                }}
              />
            )}
            {view === "Desking" && !quickQuoteOpen && (
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
                    title="No saved proposals yet."
                    body="Use Quick quote for a temporary estimate, or open a customer profile to save a proposal."
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
            {view === "Document Vault" && (
              <DocumentVault
                ws={ws}
                demo={demo}
                onRefresh={refresh}
                onCustomer={openCustomer}
              />
            )}
            {view === "Appraisals" && (
              <Appraisals
                ws={ws}
                run={run}
                busy={busy}
                demo={demo}
                onCustomer={openCustomer}
              />
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
                <UserProfileSettings ws={ws} run={run} busy={busy} />
                <WorkflowSettings ws={ws} run={run} busy={busy} demo={demo} />
                <PushSettings demo={demo} />
                <EmailSettingsPanel
                  ws={ws}
                  busy={busy}
                  error={error}
                  run={run}
                  demo={demo}
                />
                <TeamSettings
                  onAccountChanged={refresh}
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
                      subtitle="Your account and dealership details."
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
                      Download the records available to your account, including
                      customers, inventory, appointments, tasks, conversations,
                      deals and saved proposals.
                    </p>
                    <button className="btn" onClick={exportData}>
                      <Download size={16} />
                      Export workspace
                    </button>
                    <div className="security-line">
                      <ShieldCheck size={16} />
                      Access follows your staff role
                    </div>
                    <div className="security-line">
                      <Database size={16} />
                      {demo
                        ? "Sample data held only in this tab"
                        : "Export includes saved records and deal history"}
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <SectionTitle title="Workspace tools" />
                  <div className="roadmap-grid">
                    <div>
                      <CheckCircle2 />
                      <h3>Sales and finance</h3>
                      <p>
                        Manage customers, appointments, inventory and trade-ins.
                        Build quotes and F&I menus, print deal paperwork, and
                        review accounting and commissions.
                      </p>
                    </div>
                    <div>
                      <Link2 />
                      <h3>Communication status</h3>
                      <p>
                        Email templates, signatures and website lead
                        acknowledgments are available. Replies appear in
                        customer activity and Needs attention. SMS remains
                        available for drafts until its provider is connected.
                      </p>
                    </div>
                    <div>
                      <Users />
                      <h3>Team access</h3>
                      <p>
                        Each staff member uses their own account. Managers can
                        add salespeople, share account setup links, assign work
                        and transfer open tasks when someone leaves the team.
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
                {demo ? "Interactive demo" : "Staff workspace"}{" "}
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
          onRefresh={refresh}
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
            ws={ws}
            existing={edit}
            busy={busy}
            error={error}
            submit={async (data, appointment) => {
              const result = await run(
                edit
                  ? { type: "update_customer", id: edit.id, customer: data }
                  : { type: "create_customer", customer: data, appointment },
                edit
                  ? "Profile updated"
                  : appointment
                    ? "Customer added and appointment scheduled"
                    : "Customer added",
              );
              if (result.ok) {
                setModal(null);
                setEdit(null);
                if (result.id && !edit) {
                  setSelected(result.id);
                  setSelectedOpp(null);
                  setProfileTab("Activity");
                  setNote("");
                }
              }
            }}
          />
        </Modal>
      )}
      {attentionTask &&
        (findCustomer(attentionTask.customer_id) ? (
          <TaskAction
            task={attentionTask}
            customer={findCustomer(attentionTask.customer_id)!}
            ws={ws}
            run={run}
            busy={busy}
            onCompose={(compose) => {
              setAttentionCompose({
                customer: findCustomer(attentionTask.customer_id)!,
                compose,
              });
              setAttentionTask(null);
            }}
            onClose={() => setAttentionTask(null)}
          />
        ) : (
          <Modal
            title={attentionTask.title}
            onClose={() => setAttentionTask(null)}
          >
            <div className="modal-form">
              <p>Due {attentionTask.due_date}</p>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    (
                      await run(
                        { type: "complete_task", id: attentionTask.id },
                        "Task completed",
                      )
                    ).ok
                  )
                    setAttentionTask(null);
                }}
              >
                Mark task complete
              </button>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </div>
          </Modal>
        ))}
      {attentionCompose && (
        <MessageComposer
          onRefresh={refresh}
          ws={ws}
          customer={attentionCompose.customer}
          compose={attentionCompose.compose}
          run={run}
          busy={busy}
          onClose={() => setAttentionCompose(null)}
        />
      )}
      {appointmentDialog && (
        <AppointmentDialog
          key={appointmentDialog === "new" ? "new" : appointmentDialog.id}
          ws={ws}
          existing={appointmentDialog === "new" ? undefined : appointmentDialog}
          initialDate={
            appointmentDialog === "new" && view === "Planner"
              ? planDate
              : undefined
          }
          busy={busy}
          error={error}
          run={run}
          onClose={() => setAppointmentDialog(null)}
          onCustomer={(c, oid) => {
            setAppointmentDialog(null);
            openCustomer(c, oid);
          }}
        />
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
            websiteConnected={alerts.feed.websiteInventory?.connected}
            onDelete={
              inventoryEdit && canManage(ws.member.role)
                ? async (reason) => {
                    const result = await run(
                      {
                        type: "delete_inventory",
                        id: inventoryEdit.id,
                        updated_at: inventoryEdit.updated_at,
                        reason,
                      },
                      "Inventory vehicle deleted",
                    );
                    if (result.ok) {
                      setModal(null);
                      setInventoryEdit(null);
                    }
                    return result.ok;
                  }
                : undefined
            }
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
    <button className={`stat-card stat-${color}`} onClick={onClick}>
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
  appointments,
  ws,
  onAppointment,
  taskRow,
  open,
  onDay,
}: {
  mode: "Day" | "Week" | "Month";
  date: string;
  today: string;
  tasks: Task[];
  appointments: Appointment[];
  ws: Workspace;
  onAppointment: (a: Appointment) => void;
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
        {appointments
          .filter((a) => appointmentLocalParts(a.starts_at).date === date)
          .map((a) => (
            <AppointmentRow
              key={a.id}
              appointment={a}
              ws={ws}
              onClick={onAppointment}
            />
          ))}
        {tasks.filter((t) => t.due_date === date).map(taskRow)}
        {!tasks.some((t) => t.due_date === date) &&
          !appointments.some(
            (a) => appointmentLocalParts(a.starts_at).date === date,
          ) && (
            <Empty
              title="A little breathing room."
              body="No open tasks or appointments on this day. Plan the next conversation or visit."
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
          {
            appointments.filter((a) =>
              days.includes(appointmentLocalParts(a.starts_at).date),
            ).length
          }{" "}
          appointments · {tasks.filter((t) => days.includes(t.due_date)).length}{" "}
          tasks · Eastern Time
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
            {appointments
              .filter((a) => appointmentLocalParts(a.starts_at).date === d)
              .map((a) => (
                <button
                  className="calendar-task appointment timed-appointment"
                  key={a.id}
                  onClick={() => onAppointment(a)}
                  title={`${appointmentKinds[a.kind]} · ${ws.staff.find((s) => s.id === a.assigned_to)?.name ?? ""} · ${a.description}`}
                >
                  <strong>{appointmentTime(a.starts_at)}</strong>
                  <span>
                    {ws.customers.find((c) => c.id === a.customer_id)?.name}
                  </span>
                  <small>{appointmentKinds[a.kind]}</small>
                </button>
              ))}
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
  data: { customer: Customer | null; quote?: PrintableQuote; pack?: boolean };
  dealership: string;
}) {
  const { customer: c, quote: q, pack } = data;
  if (q && !pack)
    return <PriceQuotePrint customer={c} quote={q} dealership={dealership} />;
  if (!c) return null;
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
              )
                .filter(
                  ([k]) =>
                    k !== "serviceContract" ||
                    q.values.showProtectionProducts !== false,
                )
                .map(([k, label]) => (
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
            months · {q.values.showAPR !== false && <>{q.values.apr}% APR · </>}
            {q.values.daysToFirstPayment ?? 30} days to first payment. Subject
            to lender terms.
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
