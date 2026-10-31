import { protectionErrors } from "../../../lib/protection";
import { managementErrors } from "../../../lib/service";
import { dispatchReports } from "../../../lib/report-worker";
import { businessErrors } from "../../../lib/business";
import { duplicateError } from "../../../lib/customer-matches";
import { titleErrors } from "../../../lib/title-clerk";
import { customerLinkErrors } from "../../../lib/customer-links";
import { NextRequest, NextResponse, after } from "next/server";
import { dispatchEmail } from "../../../lib/messaging";
import { session, workspace, db } from "../../../lib/server";
import { commandSchema, canManage } from "../../../lib/model";
import { protectionDraft } from "../../../lib/protection";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in to access your dealership." }, 401);
    return json(await workspace(s));
  } catch {
    return json(
      { error: "Your workspace could not be loaded. Please try again." },
      503,
    );
  }
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  if (Number(req.headers.get("content-length") || 0) > 200000)
    return json({ error: "Request too large." }, 413);
  try {
    const s = await session();
    if (!s) return json({ error: "Your session ended. Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 200000) return json({ error: "Request too large." }, 413);
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return json(
        {
          error:
            parsed.error.issues[0]?.message || "Check the information entered.",
        },
        400,
      );
    if (parsed.data.type === "issue_protection") {
      if (!canManage(s.role))
        return json({ error: "Manager access required." }, 403);
      const [{ buildProtectionPdf }, { protectionPdfAssets }] =
        await Promise.all([
          import("../../../lib/protection-pdf"),
          import("../../../lib/protection-pdf-server"),
        ]);
      const { logo, fonts } = await protectionPdfAssets();
      try {
        await buildProtectionPdf(
          protectionDraft(parsed.data.contract),
          logo,
          true,
          false,
          fonts,
        );
      } catch {
        return json(
          {
            error:
              "Contract details are too long to print. Shorten the holder, vehicle, address or lender fields and preview again.",
          },
          400,
        );
      }
    }
    const { data: id, error } = await db().rpc("dmcrm_command", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_command: parsed.data,
    });
    if (error)
      return json(
        {
          error:
            error.code === "23505" && parsed.data.type === "save_temp_tag"
              ? "This tag number is already recorded"
              : error.code === "23505" && parsed.data.type === "save_staff"
                ? "That email is already on your team."
                : error.code === "23505" &&
                    parsed.data.type === "save_inventory"
                  ? "That VIN or stock number is already in this dealership’s inventory."
                  : error.message === "Select an in-stock vehicle"
                    ? "That vehicle is no longer in stock. Refresh and select another vehicle."
                    : [
                          ...businessErrors,
                          ...protectionErrors,
                          ...managementErrors,
                          duplicateError,
                          "Appraisal changed in another session. Reload before saving.",
                          "Appraisal source cannot be changed",
                          "Closed deal appraisals are read-only",
                          "Only the assigned salesperson or a manager can edit this appraisal",
                          "This trade already has an appraisal. Reload to open it.",
                          "Check the appraisal vehicle and values",
                          "Enter an offer and expected selling price before approval",
                          "Trade details changed. Refresh the appraisal vehicle before approval.",
                          "Approve a linked trade appraisal before applying its ACV",
                          "Opportunity changed. Reload before applying this appraisal.",
                          "This appraisal has already been applied",
                          "You can only change your own appointments",
                          "Only managers can assign appointments to another user",
                          "Appointment changed in another session. Reload before saving.",
                          "This appointment is closed. Schedule another visit instead.",
                          "An arrived appointment cannot be rescheduled. Schedule another visit instead.",
                          "Invalid appointment status change",
                          "Manager access required",
                          "This alert is no longer available. Refresh the attention feed.",
                          "This vehicle was deleted. Refresh and select another vehicle.",
                          "This trade was deleted. Refresh the trade list.",
                          "Enter a reason for deleting this vehicle",
                          "Delete this vehicle from Trade-ins to also remove its intake record.",
                          "A completed wholesale sale cannot be deleted.",
                          "Vehicle changed in another session. Reload before deleting.",
                          "This vehicle is attached to an active or sold deal. Resolve that deal before deleting.",
                          "Enter an unwind reason",
                          "This trade is already in intake. Review its existing disposition first.",
                          "Only a currently sold deal can be unwound",
                          "This trade was sold wholesale. Resolve its disposition before unwinding.",
                          "This trade is attached to another opportunity. Resolve that deal before unwinding.",
                          "This inventory vehicle belongs to another sold deal",
                          "Unwound accounting is retained read-only",
                          "Accounting changed in another session. Reload before saving.",
                          "Previously paid commissions must be retained",
                          "Select a dealership team member",
                          "Duplicate commission entry",
                          "Default commission is below the paid amount. Review costs or keep the agreed amount as a manual entry.",
                          "Enter first and last name, email, phone and a complete address",
                          "Trade changed in another session. Reload before saving.",
                          "This trade disposition is read-only",
                          "Edit this vehicle through its current inventory or deal",
                          "This trade is attached to another opportunity",
                          "Trade VIN or stock number already exists in inventory. Review the existing vehicle first.",
                          "Complete the vehicle details before moving to inventory",
                          "Only your unsent drafts can be edited",
                          "Email settings changed. Refresh before saving.",
                          "Email template unavailable",
                          "Choose another automatic reply template or turn off the workflow before deleting this template.",
                          "Check the email template fields and personalization tokens.",
                          "Keep the signature under 3,000 characters.",
                          "Choose an automatic reply template.",
                          "Draft changed in another session. Reload before saving.",
                          "Select an active team member",
                          "Choose an active replacement for unfinished work",
                          "Only the owner can add managers",
                          "Only the owner can manage managers; owner access is protected",
                          "Manager access required to reassign an opportunity",
                          "Only managers can assign tasks to another user",
                          "You can only complete your own tasks",
                          "Login email cannot be changed here",
                          "Closed opportunity is read-only",
                          "Select an active opportunity",
                          "Complete the trade vehicle details or remove the trade before marking this deal sold.",
                          "This inventory vehicle has already been sold",
                          "Paperwork changed in another session. Reload before saving.",
                          "This template is used by an automation. Change the automation first.",
                          "Workflow changed. Refresh before saving.",
                          "Assigned salesperson or manager required",
                          "Record changed. Refresh before saving.",
                          ...titleErrors,
                          ...customerLinkErrors,
                          "Manager access required for funding changes",
                          "Enter the funded date",
                          "Check recon items",
                          "Sold inventory recon is read-only; adjust the sale accounting",
                          "This email has already entered delivery",
                        ].includes(error.message)
                      ? error.message
                      : "The change could not be saved. Refresh and try again.",
        },
        error.code === "42501" ? 403 : 400,
      );
    after(async () => {
      await Promise.all([
        dispatchEmail(s.org_id),
        parsed.data.type === "queue_management_report"
          ? dispatchReports(s.org_id)
          : Promise.resolve(true),
      ]);
    });
    return json({ id, workspace: await workspace(s) });
  } catch {
    return json(
      { error: "Could not save your change. Please try again." },
      503,
    );
  }
}
