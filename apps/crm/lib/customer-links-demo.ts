import {
  canManage,
  myStaffId,
  opportunityOpen,
  type Command,
  type Customer,
  type Workspace,
} from "./model";
import { fullName, personFromCustomer } from "./people";
import { mergedCustomerDetails, type CoBuyerLink } from "./customer-links";
import { clearCoBuyerPaperwork } from "./co-buyer-paperwork";

export function resolveDemoCoBuyer(
  ws: Workspace,
  link: CoBuyerLink,
  stamp: string,
  buyerId?: string,
) {
  if (link.mode === "none") return null;
  if (link.mode === "existing") {
    const cid =
      ws.customer_aliases?.find((c) => c.id === link.customer_id)
        ?.customer_id ?? link.customer_id;
    if (cid === buyerId)
      throw Error("A customer cannot be their own co-buyer.");
    const c = ws.customers.find((c) => c.id === cid && c.org_id === ws.org.id);
    if (!c)
      throw Error(
        "Co-buyer profile unavailable. Refresh and choose a customer.",
      );
    return { id: c.id, name: c.name, person: personFromCustomer(c) };
  }
  const c: Customer = {
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    name: fullName(link.person),
    phone: link.person.phone,
    email: link.person.email,
    person: structuredClone(link.person),
    source: "Co-buyer",
    status: "new",
    vehicle_interest: "",
    trade_vehicle: "",
    birthday: null,
    sold_on: null,
    assigned_to: myStaffId(ws) ?? null,
    created_at: stamp,
    updated_at: stamp,
  };
  // Creating a co-buyer does not create a sales lead, appointment, or outbound message.
  ws.customers.unshift(c);
  ws.activities.unshift({
    id: crypto.randomUUID(),
    org_id: ws.org.id,
    customer_id: c.id,
    kind: "system",
    body: "Customer profile created for a co-buyer",
    created_at: stamp,
    created_by: ws.member.name,
  });
  return { id: c.id, name: c.name, person: personFromCustomer(c) };
}

export function refreshDemoCoBuyer(
  ws: Workspace,
  customer: Customer,
  stamp: string,
) {
  for (const c of ws.customers)
    if (c.co_buyer_id === customer.id) {
      c.co_buyer = personFromCustomer(customer);
      c.updated_at = stamp;
    }
  for (const o of ws.opportunities)
    if (o.co_buyer_id === customer.id && opportunityOpen(o)) {
      if (
        JSON.stringify(o.co_buyer) !==
        JSON.stringify(personFromCustomer(customer))
      ) {
        const paperwork = clearCoBuyerPaperwork(o.paperwork);
        if (JSON.stringify(paperwork) !== JSON.stringify(o.paperwork)) {
          o.paperwork = paperwork;
          o.paperwork_revision++;
        }
      }
      o.co_buyer = personFromCustomer(customer);
      o.updated_at = stamp;
    }
}

export function demoCustomerMerge(
  ws: Workspace,
  p: Extract<Command, { type: "merge_customers" }>,
  now: Date,
): Workspace {
  if (!canManage(ws.member.role)) throw Error("Manager access required");
  const s = structuredClone(ws),
    stamp = now.toISOString();
  const src = s.customers.find(
    (c) => c.id === p.source_id && c.org_id === s.org.id,
  );
  const dst = s.customers.find(
    (c) => c.id === p.target_id && c.org_id === s.org.id,
  );
  if (
    !src &&
    dst &&
    s.customer_aliases?.some(
      (a) => a.id === p.source_id && a.customer_id === dst.id,
    )
  )
    return s;
  if (
    !src ||
    !dst ||
    src.updated_at !== p.source_updated_at ||
    dst.updated_at !== p.target_updated_at
  )
    throw Error(
      "Customer profiles changed. Refresh and review the merge again.",
    );
  if (
    s.visits.some((v) => v.customer_id === src.id && !v.departed_at) &&
    s.visits.some((v) => v.customer_id === dst.id && !v.departed_at)
  )
    throw Error(
      "Check one profile out of the showroom before merging two active visits.",
    );
  if (
    src.co_buyer_id === dst.id ||
    dst.co_buyer_id === src.id ||
    s.opportunities.some(
      (o) =>
        (o.customer_id === src.id && o.co_buyer_id === dst.id) ||
        (o.customer_id === dst.id && o.co_buyer_id === src.id),
    )
  )
    throw Error(
      "Remove the co-buyer link between these profiles before merging them.",
    );
  s.customer_aliases ??= [];
  if (p.details_from === "source")
    s.customer_aliases.push({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      customer_id: dst.id,
      name: dst.name,
      email: dst.email,
      phone: dst.phone,
      merged_at: stamp,
    });
  s.customer_aliases.push({
    id: src.id,
    org_id: s.org.id,
    customer_id: dst.id,
    name: src.name,
    email: src.email,
    phone: src.phone,
    merged_at: stamp,
  });
  Object.assign(dst, mergedCustomerDetails(dst, src, p.details_from), {
    updated_at: stamp,
  });
  const tables = [
    "opportunities",
    "activities",
    "appointments",
    "deal_files",
    "facebook_messages",
    "messages",
    "quotes",
    "sales",
    "sales_events",
    "tasks",
    "title_cases",
    "trades",
    "visits",
    "workflow_jobs",
  ] as const;
  for (const table of tables) {
    const records = s[table] as { customer_id?: string }[] | undefined;
    for (const row of records ?? [])
      if (row.customer_id === src.id) row.customer_id = dst.id;
  }
  for (const q of Object.values(s.quick_quote_conversions ?? {}))
    if (q.customer_id === src.id) q.customer_id = dst.id;
  for (const a of s.customer_aliases)
    if (a.customer_id === src.id) a.customer_id = dst.id;
  for (const c of s.customers)
    if (c.co_buyer_id === src.id) c.co_buyer_id = dst.id;
  for (const o of s.opportunities) {
    if (o.customer_id === dst.id) o.updated_at = stamp;
    if (o.co_buyer_id === src.id) {
      o.co_buyer_id = dst.id;
      o.updated_at = stamp;
    }
  }
  refreshDemoCoBuyer(s, dst, stamp);
  const paused = s.workflow_pauses?.some(
    (p) => [src.id, dst.id].includes(p.customer_id) && p.paused,
  );
  s.workflow_pauses = (s.workflow_pauses ?? []).filter(
    (p) => ![src.id, dst.id].includes(p.customer_id),
  );
  if (paused)
    s.workflow_pauses.push({
      org_id: s.org.id,
      customer_id: dst.id,
      paused: true,
    });
  if (!s.buyer_preferences?.some((p) => p.id === dst.id)) {
    const preference = s.buyer_preferences?.find((p) => p.id === src.id);
    if (preference) preference.id = dst.id;
  }
  const birthdays = new Set<string>();
  for (const t of s.tasks)
    if (
      t.customer_id === dst.id &&
      !t.opportunity_id &&
      t.kind === "birthday" &&
      !t.completed_at &&
      !t.canceled_at
    ) {
      if (birthdays.has(t.due_date)) t.canceled_at = stamp;
      birthdays.add(t.due_date);
    }
  s.customers = s.customers.filter((c) => c.id !== src.id);
  s.buyer_preferences = s.buyer_preferences?.filter((p) => p.id !== src.id);
  s.activities.unshift({
    id: crypto.randomUUID(),
    org_id: s.org.id,
    customer_id: dst.id,
    kind: "system",
    body: `Merged duplicate customer profile: ${src.name}. All deals, correspondence, tasks, appointments, and files retained. Original sold paperwork preserved.`,
    created_at: stamp,
    created_by: s.member.name,
  });
  return s;
}
