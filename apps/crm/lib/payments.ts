import { z } from "zod";

export type Payment = {
  id: string;
  inventory_id: string;
  stock_number: string;
  vehicle_name: string;
  employee_id: string;
  employee_name: string;
  payer_name: string;
  purpose: string;
  amount_cents: number;
  status: "pending" | "processing" | "paid" | "canceled";
  paid_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  created_at: string;
  livemode: boolean | null;
};

export const paymentCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    id: z.uuid(),
    inventory_id: z.uuid("Select a vehicle from inventory."),
    employee_id: z.uuid("Employee ID is required."),
    payer_name: z.string().trim().min(1, "Enter the payer’s name.").max(120),
    purpose: z.string().trim().min(1, "Enter the purpose of this payment.").max(160),
    amount_cents: z.number().int().min(50, "A card payment must be at least $0.50.").max(99999999),
  }).strict(),
  z.object({ action: z.literal("resume"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("verify"), id: z.uuid() }).strict(),
]);
export type PaymentCommand = z.infer<typeof paymentCommandSchema>;
