import { z } from "zod";

export function normalizeStaffPhone(value: string) {
  value = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return value.trim();
}

const staffNameFields = {
  first_name: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(60)
    .transform((v) => v.replace(/\s+/g, " ")),
  last_name: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(60)
    .transform((v) => v.replace(/\s+/g, " ")),
};
export const profileNameSchema = z
  .object(staffNameFields)
  .refine(
    (v) => `${v.first_name} ${v.last_name}`.length <= 120,
    "Full name must be 120 characters or fewer.",
  );
export const staffSchema = z
  .object({
    ...staffNameFields,
    email: z.string().trim().toLowerCase().pipe(z.email().max(250)),
    phone: z
      .string()
      .trim()
      .max(30)
      .transform(normalizeStaffPhone)
      .refine(
        (v) => /^\+[1-9]\d{7,14}$/.test(v),
        "Enter a valid phone number, including country code outside the US.",
      ),
    address1: z.string().trim().min(1, "Street address is required.").max(250),
    address2: z.string().trim().max(250).default(""),
    city: z.string().trim().min(1, "City is required.").max(100),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use a two-letter state code."),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Enter a five-digit ZIP code or ZIP+4."),
    role: z.enum(["sales", "manager"]),
  })
  .transform((v) => ({ ...v, name: `${v.first_name} ${v.last_name}` }))
  .refine(
    (v) => v.name.length <= 120,
    "Full name must be 120 characters or fewer.",
  );

export type StaffDetails = z.infer<typeof staffSchema>;
export const staffPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters for the password.")
  .max(128);
export const teamAccountSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    staff: staffSchema,
    password: staffPasswordSchema,
  }),
  z.object({
    action: z.literal("set_password"),
    staff_id: z.uuid(),
    password: staffPasswordSchema,
  }),
]);

export function mayManageStaff(
  actor: { role: string; user_id: string },
  target: { role: string; user_id: string | null },
) {
  return (
    ["owner", "manager"].includes(actor.role) &&
    target.role !== "owner" &&
    target.user_id !== actor.user_id &&
    (actor.role === "owner" || target.role === "sales")
  );
}
