import { z } from "zod";

export const vehicleStatuses = [
  "draft",
  "available",
  "pending",
  "sold",
  "archived",
] as const;
export const leadStatuses = [
  "new",
  "contacted",
  "appointment",
  "won",
  "lost",
] as const;
export const vehicleSchema = z
  .object({
    year: z.coerce
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 2),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(80),
    trim: z.string().trim().max(100).default(""),
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-HJ-NPR-Z0-9]{17}$/,
        "VIN must contain 17 letters/numbers (no I, O, or Q).",
      ),
    stock_number: z.string().trim().min(1).max(40),
    miles: z.coerce.number().int().min(0).max(2000000),
    internet_price: z.coerce.number().min(1).max(2000000).multipleOf(0.01),
    body_style: z.string().trim().max(60).default(""),
    transmission: z.string().trim().max(80).default(""),
    fuel: z.string().trim().max(60).default(""),
    exterior: z.string().trim().max(60).default(""),
    drivetrain: z.string().trim().max(60).default(""),
    description: z.string().trim().max(12000).default(""),
    financing: z.string().trim().max(4000).default(""),
    features: z.array(z.string().trim().min(1).max(100)).max(80),
    photos: z.array(z.string().max(200)).max(40),
    status: z.enum(vehicleStatuses),
    featured: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (
      ["available", "pending", "sold"].includes(v.status) &&
      (!v.photos.length || v.description.length < 20)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Add at least one photo and a description (20+ characters) before publishing.",
      });
    }
  });

export type Vehicle = z.infer<typeof vehicleSchema> & {
  id: string;
  slug: string;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
};
export const vehicleTitle = (
  v: Pick<Vehicle, "year" | "make" | "model" | "trim">,
) => `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`;
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export function vehicleSlug(
  v: Pick<Vehicle, "year" | "make" | "model" | "trim">,
  id: string,
) {
  return `${vehicleTitle(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${id.slice(0, 8)}`;
}
export function inventoryMatches(v: Vehicle, q = "", body = "", maxPrice = "") {
  return (
    v.status === "available" &&
    (!body || v.body_style === body) &&
    (!maxPrice || v.internet_price <= Number(maxPrice)) &&
    (!q ||
      `${vehicleTitle(v)} ${v.stock_number} ${v.features.join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase().trim()))
  );
}
export function schemaAvailability(status: Vehicle["status"]) {
  return status === "sold"
    ? "https://schema.org/SoldOut"
    : status === "available"
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";
}
export const leadSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(["vehicle", "contact", "finance", "employment"]),
    vehicleId: z.union([z.string().uuid(), z.literal("")]).optional(),
    name: z.string().trim().min(2).max(120),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().trim().max(40).default(""),
    preferredContact: z.enum(["Email", "Phone call", "Text message"]),
    message: z.string().trim().max(6000).default(""),
    experience: z.string().trim().max(6000).default(""),
    vehicleType: z.string().max(100).optional(),
    budget: z.string().max(100).optional(),
    vehicle: z.string().max(120).optional(),
    downPayment: z.string().max(100).optional(),
    reason: z.string().max(120).optional(),
    position: z.string().max(120).optional(),
    website: z.string().max(200).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.preferredContact === "Email" && !v.email)
      ctx.addIssue({
        code: "custom",
        message: "Enter an email address for your reply.",
      });
    if (
      v.preferredContact !== "Email" &&
      v.phone.replace(/\D/g, "").length < 10
    )
      ctx.addIssue({
        code: "custom",
        message: "Enter a phone number for your reply.",
      });
    if (v.kind === "contact" && !v.message)
      ctx.addIssue({ code: "custom", message: "Please enter your message." });
    if (v.kind === "employment" && (!v.position || !v.experience))
      ctx.addIssue({
        code: "custom",
        message: "Please add your position and experience.",
      });
  });
