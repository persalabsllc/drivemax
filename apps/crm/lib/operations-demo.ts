import type { Command, Opportunity, Workspace } from "./model";
import {
  emptyAccounting,
  productsTotal,
  type Sale,
  type TradeIntake,
} from "./operations";

export function seedOperations(input: Workspace) {
  const s = structuredClone(input);
  s.sales ??= [];
  s.trades ??= [];
  s.commissions ??= [];
  s.messages ??= [];
  for (const o of s.opportunities.filter((o) => o.status === "sold"))
    recordSale(s, o, new Date().toISOString());
  return s;
}
function recordSale(s: Workspace, o: Opportunity, stamp: string) {
  if (s.sales!.some((x) => x.opportunity_id === o.id && x.status === "sold"))
    return;
  const c = s.customers.find((c) => c.id === o.customer_id)!;
  const snap = o.sale_snapshot,
    q = snap?.quote ?? null;
  const sale: Sale = {
    id: crypto.randomUUID(),
    org_id: s.org.id,
    opportunity_id: o.id,
    customer_id: o.customer_id,
    sold_on: o.sold_on!,
    created_at: stamp,
    status: "sold",
    snapshot: {
      customer: structuredClone(snap?.customer ?? c),
      opportunity: structuredClone(o),
      quote: structuredClone(q),
      salesperson: snap?.salesperson ?? null,
    },
    accounting: { ...emptyAccounting },
    revision: 0,
    unwound_at: null,
    unwind_reason: "",
  };
  s.sales!.push(sale);
  const t = q?.trade_snapshot ?? o.trade;
  if (t) {
    if (
      s.trades!.some(
        (x) =>
          x.vin === t.vin &&
          (["received", "wholesale"].includes(x.status) ||
            (x.status === "retail" &&
              s.inventory.find((v) => v.id === x.inventory_id)?.status !==
                "sold")),
      )
    )
      throw Error("This trade is already in intake");
    const stock =
      q?.vehicle_details?.stock_number ??
      o.vehicle_details?.stock_number ??
      s.inventory.find((v) => v.id === o.inventory_id)?.stock_number;
    s.trades!.push({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      sale_id: sale.id,
      opportunity_id: o.id,
      customer_id: c.id,
      stock_number: (stock || "TR-" + sale.id.slice(0, 8).toUpperCase()) + "A",
      vin: t.vin,
      year: t.year,
      make: t.make,
      model: t.model,
      trim: t.trim,
      mileage: t.mileage,
      color: "",
      cost: t.acv,
      recon: 0,
      price: 0,
      acquired_on: o.sold_on!,
      allowance: t.allowance,
      acv: t.acv,
      payoff: t.payoff,
      status: "received",
      inventory_id: null,
      wholesale_price: null,
      wholesale_on: null,
      notes: "",
      revision: 0,
    });
  }
}
export function demoOperations(
  input: Workspace,
  p: Command,
  now: Date,
  base: (ws: Workspace, p: Command, now: Date) => Workspace,
): Workspace {
  const s = seedOperations(input),
    stamp = now.toISOString(),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(now);
  const manager = ["owner", "manager"].includes(s.member.role);
  const checkManager = () => {
    if (!manager) throw Error("Manager access required");
  };
  const history = (c: string, o: string, body: string) =>
    s.activities.push({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      customer_id: c,
      opportunity_id: o,
      kind: "system",
      body,
      created_at: stamp,
      created_by: s.member.name,
    });
  if (p.type === "unwind_sale") {
    checkManager();
    const o = s.opportunities.find((o) => o.id === p.opportunity_id),
      sale = s.sales!.find(
        (x) => x.opportunity_id === o?.id && x.status === "sold",
      );
    if (!o || o.status !== "sold" || !sale)
      throw Error("Only a currently sold deal can be unwound");
    const trade = s.trades!.find((t) => t.sale_id === sale.id);
    if (trade?.status === "wholesaled")
      throw Error(
        "This trade was sold wholesale. Resolve its disposition before unwinding.",
      );
    if (trade?.inventory_id) {
      const v = s.inventory.find((v) => v.id === trade.inventory_id)!;
      if (
        ["sold", "pending"].includes(v.status) ||
        s.opportunities.some(
          (x) => x.inventory_id === v.id && x.status !== "lost",
        )
      )
        throw Error("This trade is attached to another opportunity");
      v.status = "archived";
    }
    if (trade) {
      trade.status = "returned";
      trade.revision++;
    }
    const v = s.inventory.find((v) => v.id === o.inventory_id);
    if (v) v.status = "in_stock";
    sale.status = "unwound";
    sale.unwound_at = stamp;
    sale.unwind_reason = p.reason;
    sale.revision++;
    for (const t of s.tasks.filter(
      (t) =>
        t.opportunity_id === o.id &&
        ["sold_followup", "anniversary"].includes(t.kind) &&
        !t.completed_at &&
        !t.canceled_at,
    ))
      t.canceled_at = stamp;
    for (const v of s.visits.filter(
      (v) => v.opportunity_id === o.id && v.outcome === "sold",
    ))
      v.outcome = "unsold";
    o.status = "working";
    o.sold_on = null;
    o.closed_at = null;
    o.sale_snapshot = null;
    o.paperwork = {};
    o.paperwork_revision++;
    o.updated_at = stamp;
    const next = new Date(today + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    s.tasks.push({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      customer_id: o.customer_id,
      opportunity_id: o.id,
      assigned_to: o.assigned_to,
      title: "Follow up after unwound deal",
      due_date: next.toISOString().slice(0, 10),
      kind: "unsold_followup",
      channel: "call",
      completed_at: null,
      canceled_at: null,
    });
    history(
      o.customer_id,
      o.id,
      "Sold deal unwound: " +
        p.reason +
        ". Original sale retained; vehicle returned to inventory.",
    );
    return s;
  }
  if (p.type === "save_accounting") {
    checkManager();
    const sale = s.sales!.find((x) => x.id === p.sale_id);
    if (!sale || sale.status !== "sold") throw Error("Sale unavailable");
    if (sale.revision !== p.revision)
      throw Error(
        "Accounting changed in another session. Reload before saving.",
      );
    for (const old of s.commissions!.filter(
      (c) => c.sale_id === sale.id && c.paid_amount > 0,
    )) {
      const next = p.commissions.find((c) => c.id === old.id);
      if (
        !next ||
        next.paid_amount < old.paid_amount ||
        next.staff_id !== old.staff_id
      )
        throw Error("Previously paid commissions must be retained");
    }
    sale.accounting = p.accounting;
    sale.revision++;
    s.commissions = s
      .commissions!.filter((c) => c.sale_id !== sale.id)
      .concat(
        p.commissions.map((c) => {
          const staff = s.staff.find((m) => m.id === c.staff_id);
          if (!staff) throw Error("Select a dealership team member");
          return {
            ...c,
            org_id: s.org.id,
            sale_id: sale.id,
            staff_name: staff.name,
          };
        }),
      );
    history(
      sale.customer_id,
      sale.opportunity_id,
      "Deal accounting and commissions updated",
    );
    return s;
  }
  if (p.type === "update_trade_intake") {
    checkManager();
    const t = s.trades!.find((t) => t.id === p.id);
    if (!t || ["returned", "wholesaled"].includes(t.status))
      throw Error("Trade unavailable");
    if (t.revision !== p.revision)
      throw Error("Trade changed in another session. Reload before saving.");
    const reusable =
      p.trade.status === "retail" && !t.inventory_id
        ? s.inventory.find(
            (v) =>
              v.vin === t.vin &&
              v.status === "archived" &&
              s.trades!.some(
                (old) => old.inventory_id === v.id && old.status === "returned",
              ) &&
              !s.opportunities.some(
                (o) => o.inventory_id === v.id && o.status !== "lost",
              ),
          )
        : undefined;
    if (reusable) t.inventory_id = reusable.id;
    const linked = s.inventory.find((v) => v.id === t.inventory_id);
    if (linked && ["sold", "pending"].includes(linked.status))
      throw Error("Edit this vehicle through its current inventory or deal");
    if (
      linked &&
      p.trade.status !== "retail" &&
      s.opportunities.some(
        (o) => o.inventory_id === linked.id && o.status !== "lost",
      )
    )
      throw Error("This trade is attached to another opportunity");
    if (p.trade.status === "retail") {
      if (
        s.inventory.some(
          (v) =>
            v.id !== t.inventory_id &&
            (v.vin === t.vin ||
              v.stock_number.toLowerCase() ===
                p.trade.stock_number.toLowerCase()),
        )
      )
        throw Error(
          "Trade VIN or stock number already exists in inventory. Review the existing vehicle first.",
        );
      const v = {
        ...p.trade,
        vin: t.vin,
        acquired_on: t.acquired_on,
        year: p.trade.year!,
        status: "in_stock" as const,
        org_id: s.org.id,
        updated_at: stamp,
      };
      if (linked) Object.assign(linked, v);
      else {
        t.inventory_id = crypto.randomUUID();
        s.inventory.push({ ...v, id: t.inventory_id, created_at: stamp });
      }
    } else if (linked) linked.status = "archived";
    Object.assign(t, p.trade, {
      wholesale_on:
        p.trade.status === "wholesaled" ? p.trade.wholesale_on : null,
      wholesale_price:
        p.trade.status === "wholesaled" ? p.trade.wholesale_price : null,
      revision: t.revision + 1,
    });
    history(
      t.customer_id,
      t.opportunity_id,
      "Trade-in " + t.stock_number + " disposition: " + t.status,
    );
    return s;
  }
  if (p.type === "save_message" || p.type === "delete_message_draft") {
    const m = s.messages!.find((m) => m.id === p.id);
    if (
      m &&
      (m.status !== "draft" || (!manager && m.created_by !== s.member.id))
    )
      throw Error("Only your unsent drafts can be edited");
    if (m && m.revision !== p.revision)
      throw Error("Draft changed in another session. Reload before saving.");
    if (p.type === "delete_message_draft") {
      if (m) {
        m.status = "canceled";
        m.revision++;
      }
      return s;
    }
    if (!s.customers.some((c) => c.id === p.customer_id))
      throw Error("Customer unavailable");
    if (
      p.quote_id &&
      !s.quotes.some(
        (q) =>
          q.id === p.quote_id &&
          q.customer_id === p.customer_id &&
          q.opportunity_id === p.opportunity_id,
      )
    )
      throw Error("Quote unavailable");
    if (m && (m.customer_id !== p.customer_id || m.channel !== p.channel))
      throw Error("Draft customer and channel cannot change");
    if (
      p.opportunity_id &&
      !s.opportunities.some(
        (o) => o.id === p.opportunity_id && o.customer_id === p.customer_id,
      )
    )
      throw Error("Opportunity unavailable");
    if (
      p.task_id &&
      !s.tasks.some(
        (t) =>
          t.id === p.task_id &&
          t.customer_id === p.customer_id &&
          (manager || t.assigned_to === s.member.staff_id),
      )
    )
      throw Error("Task unavailable");
    if (m) Object.assign(m, p, { revision: m.revision + 1, updated_at: stamp });
    else
      s.messages!.push({
        ...p,
        org_id: s.org.id,
        status: "draft",
        direction: "outbound",
        created_at: stamp,
        updated_at: stamp,
        created_by: s.member.id,
      });
    return s;
  }
  const next = base(
    s,
    p.type === "save_quote" && p.values.products
      ? {
          ...p,
          values: { ...p.values, serviceContract: productsTotal(p.values) },
        }
      : p,
    now,
  );
  if (p.type === "mark_sold" || p.type === "close_opportunity")
    for (const o of next.opportunities.filter((o) => o.status === "sold"))
      recordSale(next, o, stamp);
  return next;
}
