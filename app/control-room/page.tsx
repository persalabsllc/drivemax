import Link from "next/link";
import {
  CarFront,
  Inbox,
  LayoutDashboard,
  LogOut,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { db, emailReady, photoUrl, requireStaff } from "../../lib/backend";
import {
  vehicleTitle,
  money,
  type Vehicle,
  vehicleStatuses,
  leadStatuses,
} from "../../lib/inventory";
import type { Lead, Message, Staff } from "../../lib/crm-types";
import { logoutAction } from "./actions";
import VehicleEditor from "./VehicleEditor";
import LeadEditor from "./LeadEditor";

export const dynamic = "force-dynamic";
const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";
export default async function ControlRoom({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireStaff();
  const p = await searchParams;
  const tab = one(p.tab) || "overview";
  const page = Math.max(1, Math.min(10000, Number(one(p.page)) || 1));
  const q = one(p.q).slice(0, 100);
  const status = one(p.status);
  const base = tab === "leads" ? "leads" : "vehicles";
  let query = db()
    .from(base)
    .select("*", { count: "exact" })
    .order(base === "leads" ? "updated_at" : "created_at", {
      ascending: false,
    });
  if (q)
    query = query.ilike(
      base === "leads" ? "name" : "make",
      `%${q.replace(/[%_]/g, "")}%`,
    );
  if (
    status &&
    (base === "leads" ? [...leadStatuses] : [...vehicleStatuses]).includes(
      status as never,
    )
  )
    query = query.eq("status", status);
  const [list, inventoryCount, newCount, followupCount, staffResult] =
    await Promise.all([
      query.range((page - 1) * 30, page * 30 - 1),
      db()
        .from("vehicles")
        .select("id", { count: "exact", head: true })
        .eq("status", "available"),
      db()
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "new"),
      db()
        .from("leads")
        .select("id", { count: "exact", head: true })
        .lte("follow_up_at", new Date().toISOString())
        .in("status", ["new", "contacted", "appointment"]),
      db()
        .from("staff")
        .select("id,name,email,role")
        .eq("active", true)
        .order("name"),
    ]);
  if (
    [list, inventoryCount, newCount, followupCount, staffResult].some(
      (r) => r.error,
    )
  )
    throw new Error("Could not load the Control Room.");
  let vehicle: Vehicle | null = null;
  let lead: Lead | null = null;
  let messages: Message[] = [];
  let vehicleLink: string | null = null;
  const vehicleId = one(p.vehicle),
    leadId = one(p.lead);
  if (vehicleId && vehicleId !== "new") {
    const r = await db()
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();
    if (r.error) throw r.error;
    vehicle = r.data as Vehicle | null;
  }
  if (leadId) {
    const [l, m] = await Promise.all([
      db().from("leads").select("*").eq("id", leadId).maybeSingle(),
      db()
        .from("messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at")
        .limit(1000),
    ]);
    if (l.error || m.error)
      throw new Error("Could not load this conversation.");
    lead = l.data as Lead | null;
    messages = m.data as Message[];
    if (lead?.vehicle_id) {
      const v = await db()
        .from("vehicles")
        .select("slug")
        .eq("id", lead.vehicle_id)
        .maybeSingle();
      if (v.data) vehicleLink = `/inventory/${v.data.slug}`;
    }
  }
  const pagination = (n: number) =>
    `/control-room?${new URLSearchParams({ tab, q, status, page: String(n) })}`;
  return (
    <div className="cr-shell">
      <aside className="cr-sidebar">
        <div className="cr-wordmark">
          DRIVE MAX<span>CONTROL ROOM</span>
        </div>
        <nav aria-label="Control Room">
          {[
            ["overview", "Overview", LayoutDashboard],
            ["inventory", "Inventory", CarFront],
            ["leads", "Lead inbox", Inbox],
          ].map(([key, label, Icon]) => {
            const C = Icon as typeof CarFront;
            return (
              <Link
                key={String(key)}
                href={`/control-room?tab=${key}`}
                aria-current={tab === key ? "page" : undefined}
              >
                <C size={19} />
                {String(label)}
              </Link>
            );
          })}
        </nav>
        <div className="cr-sidebar-bottom">
          <Link href="/" target="_blank">
            View website <ArrowUpRight size={17} />
          </Link>
          <p>
            {user.name}
            <small>{user.role}</small>
          </p>
          <form action={logoutAction}>
            <button>
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="cr-workspace">
        <header className="cr-topbar">
          <div>
            <span className="kicker">Drive Max Used Cars</span>
            <h1>
              {tab === "inventory"
                ? "Inventory"
                : tab === "leads"
                  ? "Lead inbox"
                  : "Good to have you in the driver’s seat."}
            </h1>
          </div>
          <Link
            className="button button-primary"
            href="/control-room?tab=inventory&vehicle=new"
          >
            <Plus size={17} /> Add vehicle
          </Link>
        </header>
        <div className="cr-metrics">
          <Link href="/control-room?tab=inventory&status=available">
            <span>Available vehicles</span>
            <strong>{inventoryCount.count || 0}</strong>
            <small>On the website</small>
          </Link>
          <Link href="/control-room?tab=leads&status=new">
            <span>New inquiries</span>
            <strong>{newCount.count || 0}</strong>
            <small>Ready for a first response</small>
          </Link>
          <Link href="/control-room?tab=leads">
            <span>Follow-ups due</span>
            <strong>{followupCount.count || 0}</strong>
            <small>Open leads due now</small>
          </Link>
        </div>
        {tab === "overview" && (
          <div className="cr-panel">
            <span className="kicker">Your daily workflow</span>
            <h2>Keep the lot moving.</h2>
            <p className="cr-muted">
              Add vehicles, reply to customers, and keep every next step in one
              place.
            </p>
            <div className="cr-grid">
              <Link className="cr-launch" href="/control-room?tab=inventory">
                <CarFront />
                <h3>Manage inventory →</h3>
                <p>Photos, pricing, details, and availability.</p>
              </Link>
              <Link className="cr-launch" href="/control-room?tab=leads">
                <Inbox />
                <h3>Open the lead inbox →</h3>
                <p>Conversations, notes, owners, and follow-ups.</p>
              </Link>
            </div>
            <p className="cr-status-help">
              Email sending & receiving:{" "}
              {emailReady()
                ? "Connected."
                : "Awaiting dealership email connection."}
            </p>
          </div>
        )}
        {tab !== "overview" && (
          <div className="cr-panel">
            <form className="cr-filters">
              <input type="hidden" name="tab" value={tab} />
              <label>
                {tab === "leads" ? "Customer name" : "Vehicle make"}
                <input
                  name="q"
                  defaultValue={q}
                  placeholder={
                    tab === "leads"
                      ? "Find a customer"
                      : "Toyota, Ford, Chevrolet…"
                  }
                />
              </label>
              <label>
                Status
                <select name="status" defaultValue={status}>
                  <option value="">All statuses</option>
                  {(tab === "leads" ? leadStatuses : vehicleStatuses).map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </label>
              <button className="button button-secondary">Search</button>
              <Link href={`/control-room?tab=${tab}`} className="text-link">
                Reset
              </Link>
            </form>
            <div className="cr-table-wrap">
              <table className="cr-table">
                <thead>
                  <tr>
                    <th>{tab === "leads" ? "Customer" : "Vehicle"}</th>
                    <th>Status</th>
                    <th>
                      {tab === "leads"
                        ? "Contact / follow-up"
                        : "Internet price"}
                    </th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === "leads"
                    ? (list.data as Lead[]).map((l) => (
                        <tr key={l.id}>
                          <td>
                            <strong>{l.name}</strong>
                            <small>
                              {l.kind} ·{" "}
                              {new Date(l.created_at).toLocaleDateString(
                                "en-US",
                                { timeZone: "America/New_York" },
                              )}
                            </small>
                          </td>
                          <td>
                            <span className={`cr-badge ${l.status}`}>
                              {l.status}
                            </span>
                          </td>
                          <td>
                            {l.email || l.phone}
                            {l.follow_up_at && (
                              <small>
                                Follow up:{" "}
                                {new Date(l.follow_up_at).toLocaleString(
                                  "en-US",
                                  { timeZone: "America/New_York" },
                                )}{" "}
                                ET
                              </small>
                            )}
                          </td>
                          <td>
                            <Link
                              className="text-link"
                              href={`/control-room?tab=leads&lead=${l.id}`}
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))
                    : (list.data as Vehicle[]).map((v) => (
                        <tr key={v.id}>
                          <td>
                            <strong>{vehicleTitle(v)}</strong>
                            <small>
                              Stock {v.stock_number} ·{" "}
                              {v.miles.toLocaleString()} miles
                            </small>
                          </td>
                          <td>
                            <span className={`cr-badge ${v.status}`}>
                              {v.status}
                            </span>
                          </td>
                          <td>{money(v.internet_price)}</td>
                          <td>
                            <Link
                              className="text-link"
                              href={`/control-room?tab=inventory&vehicle=${v.id}`}
                            >
                              Edit →
                            </Link>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {!list.data?.length && (
              <div className="cr-empty">
                <h3>
                  {tab === "leads"
                    ? "No inquiries here yet."
                    : "No vehicles here yet."}
                </h3>
                <p>
                  {q || status
                    ? "Try a different search or status."
                    : tab === "leads"
                      ? "Website inquiries will appear here as they arrive."
                      : "Add your first vehicle to start building the lot."}
                </p>
              </div>
            )}
            <div className="cr-pagination">
              <span>
                {list.count || 0} total · Page {page}
              </span>
              {page > 1 && <Link href={pagination(page - 1)}>← Previous</Link>}
              {(list.count || 0) > page * 30 && (
                <Link href={pagination(page + 1)}>Next →</Link>
              )}
            </div>
          </div>
        )}
        {tab === "inventory" &&
          vehicleId &&
          (vehicle || vehicleId === "new") && (
            <VehicleEditor
              key={vehicle?.updated_at || "new"}
              vehicle={vehicle}
              photoBase={photoUrl("")}
            />
          )}
        {tab === "leads" && lead && (
          <LeadEditor
            key={lead.id}
            lead={lead}
            messages={messages}
            staff={staffResult.data as Staff[]}
            canEmail={emailReady()}
            vehicleLink={vehicleLink}
          />
        )}
        {((vehicleId && vehicleId !== "new" && !vehicle) ||
          (leadId && !lead)) && (
          <p className="cr-error">
            That record was not found. Choose a record from the list.
          </p>
        )}
      </div>
    </div>
  );
}
