import type { Command, Workspace } from "./model";
import { dayKey } from "./model";
import { titleValidation, calendarDays, type TitleCase } from "./title-clerk";
import { titleAmounts } from "./title-clerk-money";

export function seedTitleClerk(input: Workspace): Workspace {
  const ws = structuredClone(input),
    stamp = new Date().toISOString();
  ws.title_cases ??= [];
  ws.temp_tags ??= [];
  ws.title_documents ??= [];
  ws.title_events ??= [];
  for (const sale of ws.sales ?? []) {
    if (
      sale.status === "sold" &&
      !ws.title_cases.some((c) => c.sale_id === sale.id)
    ) {
      const o = sale.snapshot.opportunity,
        v = o.vehicle_details;
      const c: TitleCase = {
        id: crypto.randomUUID(),
        org_id: sale.org_id,
        sale_id: sale.id,
        opportunity_id: sale.opportunity_id,
        customer_id: sale.customer_id,
        sold_on: sale.sold_on,
        customer_name: sale.snapshot.customer.name,
        vehicle_label: o.vehicle_interest,
        stock_number: v?.stock_number ?? "",
        vin: v?.vin ?? "",
        status: "sold",
        checklist: {},
        notes: "",
        pending_reason: "",
        next_action_on: null,
        ready_on: null,
        submitted_on: null,
        completed_on: null,
        revision: 0,
        created_at: stamp,
        updated_at: stamp,
      };
      ws.title_cases.push(c);
      ws.title_events.push({
        id: crypto.randomUUID(),
        org_id: sale.org_id,
        case_id: c.id,
        event: "Title case opened",
        actor_name: "System",
        detail: {},
        created_at: stamp,
      });
    }
    if (sale.status === "unwound")
      for (const tag of ws.temp_tags) {
        const c = ws.title_cases.find((c) => c.id === tag.case_id);
        if (c?.sale_id === sale.id && tag.status === "active") {
          Object.assign(tag, {
            status: "void",
            closed_on: dayKey(),
            notes: [tag.notes, "Sale unwound"].filter(Boolean).join(" · "),
            revision: tag.revision + 1,
            updated_at: stamp,
          });
          ws.title_events.push({
            id: crypto.randomUUID(),
            org_id: sale.org_id,
            case_id: c.id,
            event: "Temporary tag voided — sale unwound",
            actor_name: "System",
            detail: { number: tag.number },
            created_at: stamp,
          });
        }
      }
  }
  return ws;
}
export function demoTitleClerk(
  input: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (
    ![
      "save_title_case",
      "save_title_amounts",
      "save_temp_tag",
      "attach_title_document",
    ].includes(command.type)
  )
    return null;
  const ws = seedTitleClerk(input),
    cmd = command;
  if (
    cmd.type !== "save_title_case" &&
    cmd.type !== "save_title_amounts" &&
    cmd.type !== "save_temp_tag" &&
    cmd.type !== "attach_title_document"
  )
    return null;
  const c = ws.title_cases!.find(
    (c) => c.id === (cmd.type === "save_temp_tag" ? cmd.case_id : cmd.id),
  );
  if (!c) throw Error("Title case unavailable");
  const o = ws.opportunities.find((o) => o.id === c.opportunity_id);
  if (
    !["owner", "manager"].includes(ws.member.role) &&
    o?.assigned_to !== ws.member.staff_id
  )
    throw Error("Assigned salesperson or manager required");
  const today = dayKey(now),
    stamp = now.toISOString();
  if (
    cmd.type !== "attach_title_document" &&
    !ws.sales?.some((s) => s.id === c.sale_id && s.status === "sold")
  )
    throw Error("Unwound sale is read-only");
  let event = "Paperwork updated",
    detail: Record<string, unknown> = {};
  if (cmd.type === "save_title_amounts") {
    if (!["owner", "manager"].includes(ws.member.role))
      throw Error("Manager required to correct DMV amounts");
    if (cmd.revision !== c.revision)
      throw Error("Record changed. Refresh before saving.");
    const previous = titleAmounts(ws, c);
    detail = {
      before: c.amounts ?? { fees: previous.fees, taxes: previous.taxes },
      after: cmd.values,
    };
    c.amounts = { ...cmd.values };
    c.revision++;
    c.updated_at = stamp;
    event = "DMV amounts reviewed";
  } else if (cmd.type === "save_title_case") {
    if (cmd.revision !== c.revision)
      throw Error("Record changed. Refresh before saving.");
    const error = titleValidation(c, cmd.values, today);
    if (error) throw Error(error);
    detail = { before: { ...c }, after: cmd.values };
    Object.assign(c, cmd.values, {
      revision: c.revision + 1,
      updated_at: stamp,
    });
  } else if (cmd.type === "save_temp_tag") {
    const v = cmd.values,
      old = ws.temp_tags!.find((t) => t.id === cmd.id);
    if (old && old.case_id !== c.id) throw Error("Title case unavailable");
    if (cmd.revision !== (old?.revision ?? 0))
      throw Error("Record changed. Refresh before saving.");
    if (old && old.status !== "active" && v.status === "active")
      throw Error("Closed tags cannot be reactivated");
    if (
      v.issued_on < c.sold_on ||
      v.issued_on > today ||
      calendarDays(v.issued_on, v.expires_on) < 0 ||
      calendarDays(v.issued_on, v.expires_on) > 60 ||
      (v.status === "active") === !!v.closed_on ||
      (v.closed_on && (v.closed_on < v.issued_on || v.closed_on > today))
    )
      throw Error("Check the temporary tag dates (up to 60 days)");
    if ((v.status === "void" || v.status === "replaced") && !v.notes)
      throw Error("Enter a reason for replacing or voiding a tag");
    if (
      ws.temp_tags!.some(
        (t) =>
          t.id !== cmd.id &&
          t.number.replaceAll("-", "") === v.number.replaceAll("-", ""),
      )
    )
      throw Error("This tag number is already recorded");
    if (
      v.status === "active" &&
      ws.temp_tags!.some(
        (t) => t.id !== cmd.id && t.case_id === c.id && t.status === "active",
      )
    )
      throw Error("Close the current tag before recording another");
    event = old ? "Temporary tag updated" : "Temporary tag recorded";
    detail = { before: old ? { ...old } : null, after: v };
    if (old)
      Object.assign(old, v, { revision: old.revision + 1, updated_at: stamp });
    else
      ws.temp_tags!.push({
        ...v,
        id: cmd.id,
        org_id: c.org_id,
        case_id: c.id,
        revision: 0,
        created_at: stamp,
        updated_at: stamp,
      });
  } else {
    const f = ws.deal_files?.find((f) => f.id === cmd.file_id);
    if (
      !f ||
      f.customer_id !== c.customer_id ||
      f.opportunity_id !== c.opportunity_id
    )
      throw Error("Document does not belong to this sale");
    const old = ws.title_documents!.find((d) => d.file_id === f.id);
    if (old?.case_id === c.id) return ws;
    if (old) throw Error("Document is already filed with another title case");
    ws.title_documents!.push({
      id: crypto.randomUUID(),
      org_id: c.org_id,
      case_id: c.id,
      file_id: f.id,
      purpose: cmd.purpose,
      created_at: stamp,
    });
    event = "Document filed";
    detail = { name: f.name, purpose: cmd.purpose };
  }
  ws.title_events!.push({
    id: crypto.randomUUID(),
    org_id: c.org_id,
    case_id: c.id,
    event,
    actor_name: ws.member.name,
    detail,
    created_at: stamp,
  });
  return ws;
}
