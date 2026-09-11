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
import { leadLabel } from "../../lib/purchase-requests";
import {
  leadVehicleColumns,
  leadVehicleTitle,
  openLeadStatuses,
  vehicleInquiryPurposes,
  type LeadVehicle,
} from "../../lib/lead-vehicles";

type ListedLead = Lead & { vehicle: LeadVehicle | null };
type ListedVehicle = Vehicle & {
  leads: { count: number }[];
  open_leads: { count: number }[];
};
async function vehicleChoices() {
  const all: LeadVehicle[] = [];
  for (let start = 0; ; start += 1000) {
    const r = await db()
      .from("vehicles")
      .select(leadVehicleColumns)
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Could not load vehicle choices.");
    all.push(...(r.data as unknown as LeadVehicle[]));
    if (r.data.length < 1000) return all;
  }
}

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
  const requestType = ["purchase-offer", ...vehicleInquiryPurposes].includes(
    one(p.type),
  )
    ? one(p.type)
    : "";
  const rawVehicleFilter = one(p.vehicleFilter);
  const vehicleFilter =
    rawVehicleFilter === "unassigned" ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawVehicleFilter,
    )
      ? rawVehicleFilter
      : "";
  const base = tab === "leads" ? "leads" : "vehicles";
  let query = db()
    .from(base)
    .select(
      base === "leads"
        ? `*,vehicle:vehicles(${leadVehicleColumns})`
        : "*,leads(count),open_leads:leads(count)",
      { count: "exact" },
    )
    .order(base === "leads" ? "updated_at" : "created_at", {
      ascending: false,
    });
  if (base === "vehicles")
    query = query.in("open_leads.status", openLeadStatuses);
  if (base === "vehicles" && !status) query = query.neq("status", "archived");
  if (base === "leads" && vehicleFilter)
    query =
      vehicleFilter === "unassigned"
        ? query.is("vehicle_id", null)
        : query.eq("vehicle_id", vehicleFilter);
  if (base === "leads" && status === "open")
    query = query.in("status", openLeadStatuses);
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
  if (base === "leads" && requestType)
    query = query.eq("details->>purpose", requestType);
  const [list, inventoryCount, newCount, followupCount, staffResult, choices] =
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
      tab === "leads" ? vehicleChoices() : Promise.resolve([] as LeadVehicle[]),
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
  let leadVehicle: LeadVehicle | null = null;
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
    leadVehicle = choices.find((v) => v.id === lead?.vehicle_id) || null;
  }
  const pagination = (n: number) =>
    `/control-room?${new URLSearchParams({ tab, q, status, type: requestType, vehicleFilter, page: String(n) })}`;
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
                  <option value="">
                    {tab === "leads" ? "All statuses" : "Current inventory"}
                  </option>
                  {tab === "leads" && <option value="open">Open leads</option>}
                  {(tab === "leads" ? leadStatuses : vehicleStatuses).map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </label>
              {tab === "leads" && (
                <label>
                  Request type
                  <select name="type" defaultValue={requestType}>
                    <option value="">All inquiries</option>
                    <option value="test-drive">Test-drive requests</option>
                    <option value="vehicle-update">Availability updates</option>
                    <option value="similar-vehicle">
                      Similar vehicle requests
                    </option>
                    <option value="purchase-offer">
                      Purchase offer requests
                    </option>
                  </select>
                </label>
              )}
              {tab === "leads" && (
                <label className="cr-vehicle-filter">
                  Vehicle
                  <select name="vehicleFilter" defaultValue={vehicleFilter}>
                    <option value="">All vehicles</option>
                    <option value="unassigned">No vehicle assigned</option>
                    {choices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {leadVehicleTitle(v)} · {v.stock_number}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                    <th>
                      {tab === "leads"
                        ? "Vehicle of interest"
                        : "Customer leads"}
                    </th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === "leads"
                    ? (list.data as unknown as ListedLead[]).map((l) => (
                        <tr key={l.id}>
                          <td className="cr-record-title">
                            <Link
                              href={`/control-room?tab=leads&lead=${l.id}#lead-editor`}
                            >
                              <strong>{l.name}</strong>
                            </Link>
                            <small>
                              {leadLabel(l)} ·{" "}
                              {new Date(l.created_at).toLocaleDateString(
                                "en-US",
                                { timeZone: "America/New_York" },
                              )}
                            </small>
                          </td>
                          <td data-label="Status">
                            <span className={`cr-badge ${l.status}`}>
                              {l.status}
                            </span>
                          </td>
                          <td data-label="Contact / follow-up">
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
                          <td data-label="Vehicle of interest">
                            {l.vehicle ? (
                              <>
                                <Link
                                  className="text-link"
                                  href={`/control-room?tab=inventory&vehicle=${l.vehicle.id}`}
                                >
                                  {leadVehicleTitle(l.vehicle)}
                                </Link>
                                <small>
                                  Stock {l.vehicle.stock_number} ·{" "}
                                  {l.vehicle.miles.toLocaleString("en-US")}{" "}
                                  miles
                                </small>
                                <small>VIN {l.vehicle.vin}</small>
                              </>
                            ) : (
                              <span className="cr-muted">
                                No vehicle assigned
                              </span>
                            )}
                          </td>
                          <td className="cr-record-actions">
                            <Link
                              className="button button-secondary"
                              href={`/control-room?tab=leads&lead=${l.id}#lead-editor`}
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))
                    : (list.data as unknown as ListedVehicle[]).map((v) => (
                        <tr key={v.id}>
                          <td className="cr-record-title">
                            <Link
                              href={`/control-room?tab=inventory&vehicle=${v.id}#vehicle-editor`}
                            >
                              <strong>{vehicleTitle(v)}</strong>
                            </Link>
                            <small>
                              Stock {v.stock_number} ·{" "}
                              {v.miles.toLocaleString()} miles
                            </small>
                            <small>
                              {v.photos.length}{" "}
                              {v.photos.length === 1 ? "photo" : "photos"}
                            </small>
                          </td>
                          <td data-label="Status">
                            <span className={`cr-badge ${v.status}`}>
                              {v.status}
                            </span>
                          </td>
                          <td data-label="Internet price">
                            {money(v.internet_price)}
                          </td>
                          <td data-label="Customer leads">
                            <Link
                              className="text-link"
                              href={`/control-room?tab=leads&vehicleFilter=${v.id}&status=open`}
                            >
                              {v.open_leads?.[0]?.count || 0} open
                            </Link>
                            <small>
                              <Link
                                href={`/control-room?tab=leads&vehicleFilter=${v.id}`}
                              >
                                {v.leads?.[0]?.count || 0} total
                              </Link>
                            </small>
                          </td>
                          <td className="cr-record-actions">
                            <div>
                              <Link
                                className="button button-primary"
                                href={`/control-room?tab=inventory&vehicle=${v.id}#vehicle-editor`}
                                aria-label={`Edit ${vehicleTitle(v)}, stock ${v.stock_number}`}
                              >
                                Edit vehicle
                              </Link>
                              <Link
                                className="button button-secondary"
                                href={`/control-room?tab=inventory&vehicle=${v.id}#vehicle-photos`}
                                aria-label={`Add photos to ${vehicleTitle(v)}, stock ${v.stock_number}`}
                              >
                                Add photos
                              </Link>
                            </div>
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
                  {q || status || vehicleFilter || requestType
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
            vehicle={leadVehicle}
            vehicles={choices}
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
