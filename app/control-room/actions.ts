"use server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Resend } from "resend";
import {
  authClient,
  backendReady,
  db,
  emailReady,
  requireStaff,
  staffSession,
} from "../../lib/backend";
import { leadStatuses, vehicleSchema, vehicleSlug } from "../../lib/inventory";
import { takeSlot } from "../../lib/rate-limit";
import { leadEmailFrom, leadReplyDomain } from "../../lib/email-config";

export type ActionResult = { error?: string; message?: string; id?: string };
const idSchema = z.string().uuid();
function validation(error: z.ZodError): ActionResult {
  return { error: error.issues[0]?.message || "Check the form fields." };
}
function refreshInventory() {
  revalidatePath("/");
  revalidatePath("/inventory", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/control-room");
}

export async function loginAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  if (!backendReady())
    return { error: "Control Room setup is not finished yet." };
  const email = z.email().safeParse(
    String(form.get("email") || "")
      .trim()
      .toLowerCase(),
  );
  if (!email.success) return { error: "Enter your staff email address." };
  const password = String(form.get("password") || "");
  if (!password || password.length > 256)
    return { error: "Enter your password." };
  try {
    const h = await headers();
    if (
      !(await takeSlot(
        h.get("x-vercel-forwarded-for") ||
          h.get("x-forwarded-for") ||
          "unknown",
        "login-ip",
        30,
      )) ||
      !(await takeSlot(email.data, "login-email", 20))
    )
      return { error: "Please wait before trying again." };
    const auth = await authClient();
    const result = await auth.auth.signInWithPassword({
      email: email.data,
      password,
    });
    if (result.error || !(await staffSession())) {
      await auth.auth.signOut();
      return {
        error:
          "Email or password was not accepted for an active staff account.",
      };
    }
  } catch {
    return { error: "Sign-in is temporarily unavailable. Please try again." };
  }
  redirect("/control-room");
}
export async function logoutAction() {
  if (backendReady()) await (await authClient()).auth.signOut();
  redirect("/control-room/login");
}
export async function saveVehicle(form: FormData): Promise<ActionResult> {
  await requireStaff();
  const input = Object.fromEntries(form);
  const parsed = vehicleSchema.safeParse({
    ...input,
    featured: form.get("featured") === "on",
    features: String(form.get("features") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    photos: form.getAll("photos"),
  });
  if (!parsed.success) return validation(parsed.error);
  const rawId = String(form.get("id") || "");
  const id = rawId || randomUUID();
  if (!idSchema.safeParse(id).success) return { error: "Invalid vehicle." };
  try {
    const data = parsed.data;
    if (data.photos.length) {
      const { data: assets, error } = await db()
        .from("vehicle_assets")
        .select("path")
        .eq("vehicle_id", id)
        .in("path", data.photos);
      if (
        error ||
        new Set(assets?.map((a) => a.path)).size !== new Set(data.photos).size
      )
        return {
          error:
            "One or more photos do not belong to this vehicle. Reload and try again.",
        };
    }
    const result = rawId
      ? await db()
          .from("vehicles")
          .update(data)
          .eq("id", id)
          .eq("updated_at", String(form.get("updated_at")))
          .select("id")
          .maybeSingle()
      : await db()
          .from("vehicles")
          .insert({ ...data, id, slug: vehicleSlug(data, id) })
          .select("id")
          .single();
    if (result.error)
      return {
        error:
          result.error.code === "23505"
            ? "That VIN or stock number is already in inventory."
            : "Could not save the vehicle. Please try again.",
      };
    if (!result.data)
      return {
        error: "This vehicle changed in another session. Reload before saving.",
      };
    refreshInventory();
    return { id, message: "Vehicle saved." };
  } catch {
    return {
      error:
        "Could not save the vehicle. Your changes have not been confirmed.",
    };
  }
}
export async function saveLead(form: FormData): Promise<ActionResult> {
  await requireStaff();
  const parsed = z
    .object({
      id: idSchema,
      status: z.enum(leadStatuses),
      assigned_to: z.union([idSchema, z.literal("")]),
      follow_up_at: z.string().max(40),
      updated_at: z.string().min(1),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return validation(parsed.error);
  const v = parsed.data;
  const followUp = v.follow_up_at ? new Date(v.follow_up_at) : null;
  if (followUp && !Number.isFinite(followUp.getTime()))
    return { error: "Choose a valid follow-up date." };
  if (v.assigned_to) {
    const { data, error } = await db()
      .from("staff")
      .select("id")
      .eq("id", v.assigned_to)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) return { error: "Choose an active staff member." };
  }
  const { data, error } = await db()
    .from("leads")
    .update({
      status: v.status,
      assigned_to: v.assigned_to || null,
      follow_up_at: followUp?.toISOString() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", v.id)
    .eq("updated_at", v.updated_at)
    .select("id")
    .maybeSingle();
  if (error || !data)
    return {
      error:
        "Could not save. Reload if another staff member has updated this lead.",
    };
  revalidatePath("/control-room");
  return { message: "Lead updated." };
}
export async function addMessage(form: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = z
    .object({
      id: idSchema,
      lead_id: idSchema,
      direction: z.enum(["note", "outbound"]),
      body: z.string().trim().min(1).max(10000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return validation(parsed.error);
  const v = parsed.data;
  const { data: lead, error: leadError } = await db()
    .from("leads")
    .select("id,name,email")
    .eq("id", v.lead_id)
    .maybeSingle();
  if (leadError || !lead) return { error: "Lead not found." };
  if (v.direction === "outbound" && (!emailReady() || !lead.email))
    return {
      error: !lead.email
        ? "This customer has not provided an email address. Log your call or text as a note."
        : "Connect dealership email to send replies.",
    };
  const subject = "Your Drive Max inquiry";
  const { data: existing, error: lookupError } = await db()
    .from("messages")
    .select("*")
    .eq("id", v.id)
    .maybeSingle();
  if (lookupError) return { error: "Could not check message status." };
  if (
    existing &&
    (existing.lead_id !== v.lead_id ||
      existing.staff_id !== staff.id ||
      existing.body !== v.body ||
      existing.direction !== v.direction)
  )
    return { error: "This message changed. Reload before sending again." };
  if (existing && !["pending", "failed"].includes(existing.state))
    return { message: "Message already saved." };
  if (existing?.provider_id)
    return {
      error:
        "The email provider already accepted this message. Check its delivery status before composing another reply.",
    };
  if (
    existing &&
    Date.now() - new Date(existing.created_at).getTime() > 23 * 3600000
  )
    return {
      error:
        "This attempt is too old to retry automatically. Check its delivery status in Resend before composing a new reply.",
    };
  if (!existing) {
    const { error } = await db()
      .from("messages")
      .insert({
        ...v,
        subject,
        recipient: lead.email || null,
        staff_id: staff.id,
        state: v.direction === "note" ? "note" : "pending",
      });
    if (error)
      return { error: "Could not save this message. Please try again." };
  }
  if (v.direction === "outbound") {
    try {
      const { data, error } = await new Resend(
        process.env.RESEND_API_KEY,
      ).emails.send(
        {
          from: leadEmailFrom(),
          to: existing?.recipient || lead.email,
          subject: existing?.subject || subject,
          text: v.body,
          replyTo: `lead+${lead.id}@${leadReplyDomain()}`,
        },
        { idempotencyKey: `lead-message-${v.id}` },
      );
      if (error || !data) {
        await db()
          .from("messages")
          .update({ state: "failed" })
          .eq("id", v.id)
          .eq("state", "pending");
        revalidatePath("/control-room");
        return {
          error:
            "Email was not confirmed sent. Retry this same message; it will not be sent twice.",
        };
      }
      const saved = await db()
        .from("messages")
        .update({ state: "sent", provider_id: data.id })
        .eq("id", v.id)
        .in("state", ["pending", "failed"]);
      if (saved.error)
        return {
          error:
            "Email accepted, but its status could not be saved. Retry this same message to reconcile it.",
        };
    } catch {
      return {
        error:
          "Email delivery was not confirmed. Retry this same message to check it without duplicating it.",
      };
    }
  }
  revalidatePath("/control-room");
  return { message: v.direction === "note" ? "Note saved." : "Email sent." };
}
