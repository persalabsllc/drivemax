import { z } from "zod";
import { canManage } from "./permissions";

export type Payment = {
  id: string;
  inventory_id: string | null;
  stock_number: string;
  vehicle_name: string;
  employee_id: string;
  employee_name: string;
  payer_name: string;
  purpose: string;
  amount_cents: number;
  status: "pending" | "failed" | "processing" | "paid" | "canceled";
  paid_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  created_at: string;
  livemode: boolean | null;
};

export function canManagePayment(payment: Payment, role: string, staffId: string) {
  return (payment.status === "pending" || payment.status === "failed" || payment.status === "canceled") &&
    (payment.employee_id === staffId || canManage(role));
}

const paymentAmount = z.number().int().min(50, "A card payment must be at least $0.50.").max(99999999);

export const paymentCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    id: z.uuid(),
    inventory_id: z.uuid("Select a vehicle from inventory.").optional(),
    manual_stock_number: z.string().trim().min(1, "Enter the stock number.").max(250).optional(),
    manual_vehicle_name: z.string().trim().max(160).optional(),
    employee_id: z.uuid("Employee ID is required."),
    payer_name: z.string().trim().min(1, "Enter the payer’s name.").max(120),
    purpose: z.string().trim().min(1, "Enter the purpose of this payment.").max(160),
    amount_cents: paymentAmount,
  }).strict().refine(
    data => data.inventory_id
      ? data.manual_stock_number === undefined && data.manual_vehicle_name === undefined
      : data.manual_stock_number !== undefined,
    "Select an inventory vehicle or enter its stock number manually.",
  ),
  z.object({ action: z.literal("resume"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("verify"), id: z.uuid() }).strict(),
  z.object({
    action: z.literal("edit_amount"), id: z.uuid(), replacement_id: z.uuid(), amount_cents: paymentAmount,
  }).strict().refine(data => data.id.toLowerCase() !== data.replacement_id.toLowerCase(), "A changed payment needs a new reference."),
  z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
]);
export type PaymentCommand = z.infer<typeof paymentCommandSchema>;
