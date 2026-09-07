import { z } from "zod";
import { VIN_PATTERN } from "./vehicle-data";
import { isValidLeadPhone, phoneValidationMessage } from "./lead-phone";
import { totalVehiclePrice } from "./vehicle-pricing";
import { CONTACT_NOTICE_VERSION } from "./contact-notice";
import {
  vehicleConditions,
  titleStatuses,
  accidentHistories,
  loanStatuses,
} from "./purchase-requests";

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
    (!maxPrice || totalVehiclePrice(v.internet_price) <= Number(maxPrice)) &&
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
    contactNoticeVersion: z.literal(CONTACT_NOTICE_VERSION).optional(),
    kind: z.enum(["vehicle", "contact", "finance", "employment"]),
    vehicleId: z.union([z.string().uuid(), z.literal("")]).optional(),
    name: z.string().trim().min(2).max(120),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z
      .string()
      .trim()
      .default("")
      .refine(isValidLeadPhone, phoneValidationMessage),
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
    purpose: z
      .enum([
        "purchase-offer",
        "test-drive",
        "vehicle-update",
        "similar-vehicle",
      ])
      .optional(),
    preferredVisit: z.string().trim().max(160).optional(),
    sellerVin: z.string().trim().toUpperCase().max(17).optional(),
    sellerMiles: z.string().trim().max(10).optional(),
    sellerYear: z.string().trim().max(4).optional(),
    sellerMake: z.string().trim().max(60).optional(),
    sellerModel: z.string().trim().max(80).optional(),
    sellerTrim: z.string().trim().max(100).optional(),
    condition: z
      .enum(vehicleConditions, {
        error: "Choose the vehicle's overall condition.",
      })
      .optional(),
    titleStatus: z
      .enum(titleStatuses, { error: "Choose the vehicle's title status." })
      .optional(),
    accidentHistory: z.enum(accidentHistories).optional(),
    loanStatus: z.enum(loanStatuses).optional(),
    askingPrice: z.string().trim().max(12).optional(),
    sellerZip: z.string().trim().max(10).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.purpose &&
      v.purpose !== "purchase-offer" &&
      (v.kind !== "vehicle" || !v.vehicleId)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choose a listed vehicle before requesting a test drive or availability update.",
      });
    if (v.purpose === "purchase-offer") {
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", message });
      if (v.kind !== "vehicle" || v.vehicleId)
        issue("Please submit your vehicle through the Sell your car form.");
      if (!VIN_PATTERN.test(v.sellerVin || ""))
        issue("Enter the vehicle's complete 17-character VIN.");
      if (!/^\d+$/.test(v.sellerMiles || "") || Number(v.sellerMiles) > 2000000)
        issue("Enter a valid mileage between 0 and 2,000,000.");
      if (
        !/^\d{4}$/.test(v.sellerYear || "") ||
        Number(v.sellerYear) < 1981 ||
        Number(v.sellerYear) > new Date().getFullYear() + 2
      )
        issue("Enter the vehicle's model year (1981 or newer).");
      if (!v.sellerMake || !v.sellerModel)
        issue("Enter the vehicle's make and model.");
      if (!v.condition || !v.titleStatus)
        issue("Choose the vehicle's condition and title status.");
      if (!/^\d{5}(-\d{4})?$/.test(v.sellerZip || ""))
        issue("Enter your ZIP code.");
      if (
        v.askingPrice &&
        (!/^\d+(\.\d{1,2})?$/.test(v.askingPrice) ||
          Number(v.askingPrice) <= 0 ||
          Number(v.askingPrice) > 2000000)
      )
        issue("Enter a valid asking price, or leave it blank.");
    }
    if (v.preferredContact === "Email" && !v.email)
      ctx.addIssue({
        code: "custom",
        message: "Enter an email address for your reply.",
      });
    if (v.kind === "contact" && !v.message)
      ctx.addIssue({ code: "custom", message: "Please enter your message." });
    if (v.kind === "employment" && (!v.position || !v.experience))
      ctx.addIssue({
        code: "custom",
        message: "Please add your position and experience.",
      });
  });
