import type { Command, Workspace } from "./model";
import { canManage, myStaffId } from "./model";
import {
  tradeMatchesAppraisal,
  type Appraisal,
  type AppraisalCommand,
} from "./appraisals";

export function demoAppraisal(
  ws: Workspace,
  command: Command,
  now: Date,
): Workspace | null {
  if (
    ![
      "save_appraisal",
      "approve_appraisal",
      "apply_appraisal",
      "archive_appraisal",
    ].includes(command.type)
  )
    return null;
  const p = command as AppraisalCommand,
    s = structuredClone(ws),
    stamp = now.toISOString();
  s.appraisals ||= [];
  const me = myStaffId(s),
    manager = canManage(s.member.role);
  if (!me) throw Error("Active team membership required");
  let a = s.appraisals.find((a) => a.id === p.id);
  if (
    (!a && (p.type !== "save_appraisal" || p.revision !== 0)) ||
    (a && a.revision !== p.revision)
  )
    throw Error("Appraisal changed in another session. Reload before saving.");
  const oid =
    a?.opportunity_id ||
    (p.type === "save_appraisal" ? p.opportunity_id : null);
  const o = s.opportunities.find((o) => o.id === oid);
  if (oid && !o) throw Error("Opportunity not found");
  if (o && ["sold", "lost"].includes(o.status))
    throw Error("Closed deal appraisals are read-only");
  if (!manager && (o ? o.assigned_to !== me : a && a.created_by !== me))
    throw Error(
      "Only the assigned salesperson or a manager can edit this appraisal",
    );
  let message = "Trade appraisal saved";
  if (p.type === "save_appraisal") {
    if (a && (a.opportunity_id !== p.opportunity_id || a.source !== p.source))
      throw Error("Appraisal source cannot be changed");
    if ((p.source === "trade") !== !!p.opportunity_id)
      throw Error("Check the appraisal vehicle and values");
    if (!a && oid && s.appraisals.some((a) => a.opportunity_id === oid))
      throw Error("This trade already has an appraisal. Reload to open it.");
    const next: Appraisal = {
      id: p.id,
      org_id: s.org.id,
      opportunity_id: oid,
      source: p.source,
      data: p.data,
      status: p.status,
      revision: (a?.revision || 0) + 1,
      created_by: a?.created_by || me,
      created_at: a?.created_at || stamp,
      updated_at: stamp,
      reviewed_at: null,
      reviewed_by: null,
      reviewed_name: null,
      applied_at: null,
    };
    if (a) Object.assign(a, next);
    else {
      a = next;
      s.appraisals.push(a);
    }
    if (p.status === "review")
      message = "Trade appraisal sent for manager review";
  } else if (p.type === "archive_appraisal") {
    Object.assign(a!, {
      status: "archived",
      reviewed_at: null,
      reviewed_by: null,
      reviewed_name: null,
      revision: a!.revision + 1,
      updated_at: stamp,
    });
    message = "Trade appraisal archived";
  } else {
    if (!manager) throw Error("Manager access required");
    if (
      a!.status === "archived" ||
      a!.data.proposed_acv === null ||
      a!.data.target_value === null
    )
      throw Error("Enter an offer and expected selling price before approval");
    if (o && !tradeMatchesAppraisal(o, a!.data))
      throw Error(
        "Trade details changed. Refresh the appraisal vehicle before approval.",
      );
    if (p.type === "approve_appraisal") {
      Object.assign(a!, {
        status: "valued",
        reviewed_at: stamp,
        reviewed_by: me,
        reviewed_name: s.member.name,
        applied_at: null,
      });
      message = `Trade appraisal approved · ACV $${a!.data.proposed_acv}`;
    } else {
      if (!o || a!.status !== "valued" || !a!.reviewed_at)
        throw Error("Approve a linked trade appraisal before applying its ACV");
      if (o.updated_at !== p.opportunity_updated_at)
        throw Error(
          "Opportunity changed. Reload before applying this appraisal.",
        );
      if (a!.applied_at) throw Error("This appraisal has already been applied");
      message = `Appraisal ACV applied to trade · $${o.trade!.acv} → $${a!.data.proposed_acv}. Allowance and saved quotes unchanged.`;
      o.trade!.acv = a!.data.proposed_acv!;
      o.updated_at = stamp;
      a!.applied_at = stamp;
    }
    a!.revision++;
    a!.updated_at = stamp;
  }
  if (o)
    s.activities.unshift({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      customer_id: o.customer_id,
      opportunity_id: o.id,
      kind: "system",
      body: message,
      created_by: s.member.name,
      created_at: stamp,
    });
  return s;
}
