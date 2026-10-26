import { NextRequest, NextResponse } from "next/server";
import { session, workspace, db } from "../../../lib/server";
import { commandSchema } from "../../../lib/model";
export const dynamic = "force-dynamic";
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
    const { data: id, error } = await db().rpc("dmcrm_command", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_command: parsed.data,
    });
    if (error)
      return json(
        {
          error:
            error.code === "23505" && parsed.data.type === "save_staff"
              ? "That email is already on your team."
              : error.code === "23505" && parsed.data.type === "save_inventory"
                ? "That VIN or stock number is already in this dealership’s inventory."
                : error.message === "Select an in-stock vehicle"
                  ? "That vehicle is no longer in stock. Refresh and select another vehicle."
                  : [
                        "You can only change your own appointments",
                        "Only managers can assign appointments to another user",
                        "Appointment changed in another session. Reload before saving.",
                        "This appointment is closed. Schedule another visit instead.",
                        "An arrived appointment cannot be rescheduled. Schedule another visit instead.",
                        "Invalid appointment status change",
                        "Manager access required",
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
                        "Trade changed in another session. Reload before saving.",
                        "This trade disposition is read-only",
                        "Edit this vehicle through its current inventory or deal",
                        "This trade is attached to another opportunity",
                        "Trade VIN or stock number already exists in inventory. Review the existing vehicle first.",
                        "Complete the vehicle details before moving to inventory",
                        "Only your unsent drafts can be edited",
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
                        "This inventory vehicle has already been sold",
                        "Paperwork changed in another session. Reload before saving.",
                      ].includes(error.message)
                    ? error.message
                    : "The change could not be saved. Refresh and try again.",
        },
        error.code === "42501" ? 403 : 400,
      );
    return json({ id, workspace: await workspace(s) });
  } catch {
    return json(
      { error: "Could not save your change. Please try again." },
      503,
    );
  }
}
