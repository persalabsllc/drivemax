import { z } from "zod";

// Check printing starts with owner access, separate from general accounting.
export const canPrintCompanyChecks = (role: string) => role === "owner";
export const checkFields = ["date", "payee", "amount", "words", "address", "memo"] as const;
export type CheckField = (typeof checkFields)[number];
const offset = z.number().finite().min(-18).max(18);
const adjustment = z.object({ x: offset, y: offset }).strict();
export const checkLayoutSchema = z.object({
  x: offset, y: offset,
  stock: z.enum(["preprinted_top", "blank_bottom_1002"]).optional(),
  fields: z.object({ date: adjustment, payee: adjustment, amount: adjustment, words: adjustment, address: adjustment, memo: adjustment }).strict(),
}).strict();
export type CheckLayout = z.infer<typeof checkLayoutSchema>;
export const defaultCheckLayout: CheckLayout = {
  x: 0, y: 0,
  fields: { date: { x: 0, y: 0 }, payee: { x: 0, y: 0 }, amount: { x: 0, y: 0 }, words: { x: 0, y: 0 }, address: { x: 0, y: 0 }, memo: { x: 0, y: 0 } },
};
export const blankBottomCheckLayout: CheckLayout = { ...defaultCheckLayout, stock: "blank_bottom_1002" };
export const isBlankCheckStock = (layout: CheckLayout) => layout.stock === "blank_bottom_1002";
export const formatCheckNumber = (n: number) => String(n).padStart(5, "0");
export const checkBrand = {
  company: "Drive Max Used Cars LLC", address: "6210 Old US Hwy 70 W", city: "New Bern, NC 28562", phone: "252-541-0040",
  bank: "Bank of America, N.A.", branch: "Twin Rivers Financial Center", bankAddress: "3131 M L King Jr Blvd", bankCity: "New Bern, NC 28562",
};
const printable = (max: number) => z.string().trim().max(max)
  .regex(/^[\x20-\x7e\xa0-\xff]*$/, "Use standard letters, numbers and punctuation for check printing.");
export const checkDetailsSchema = z.object({
  payee: printable(100).min(1, "Enter the payee."),
  amount_cents: z.number().int().min(1).max(99_999_999),
  check_date: z.iso.date().refine((s) => s >= "2000-01-01" && s <= "2100-12-31", "Enter a date from 2000 through 2100."),
  memo: printable(120),
  reference: printable(80).optional(),
  category: printable(60).optional(),
  payment_details: z.string().trim().max(500).refine((s) => /^[\x20-\x7e\xa0-\xff\n]*$/.test(s) && s.split("\n").length <= 5, "Use up to five lines of payment details.").optional(),
  address: z.string().trim().max(240).refine((s) => s.split("\n").length <= 3 && s.split("\n").every((line) => /^[\x20-\x7e\xa0-\xff]{0,80}$/.test(line)), "Use up to three address lines, 80 characters each."),
}).strict();
export type CheckDetails = z.infer<typeof checkDetailsSchema>;
export const checkCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), account_id: z.uuid(), details: checkDetailsSchema }).strict(),
  z.object({ action: z.literal("save_account"), id: z.uuid(), revision: z.number().int().min(0), name: printable(80).min(1), last4: z.string().regex(/^(\d{4})?$/, "Enter only the last four account digits, or leave blank."), next_number: z.number().int().min(1).max(999_999_998), layout: checkLayoutSchema }).strict(),
  z.object({ action: z.literal("create"), id: z.uuid(), account_id: z.uuid(), check_number: z.number().int().min(1).max(999_999_998), details: checkDetailsSchema }).strict(),
  z.object({ action: z.literal("pdf"), id: z.uuid(), revision: z.number().int().min(1), stock_confirmed: z.literal(true), reason: printable(240) }).strict(),
  z.object({ action: z.literal("mark_printed"), id: z.uuid(), revision: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("void"), id: z.uuid(), revision: z.number().int().min(1), reason: printable(240).min(3, "Enter a reason for voiding this check.") }).strict(),
]);
export type CheckCommand = z.infer<typeof checkCommandSchema>;
export type CheckAccount = { id: string; name: string; last4: string; next_number: number; revision: number; layout: CheckLayout; bank_ready?: boolean };
export type CompanyCheck = CheckDetails & {
  id: string; account_id: string; account_name: string; account_last4: string; check_number: number;
  status: "prepared" | "printed" | "voided"; revision: number; pdf_count: number;
  created_at: string; printed_at: string | null; voided_at: string | null; void_reason: string;
};
export type CheckRegister = { accounts: CheckAccount[]; checks: CompanyCheck[]; total: number };

/** Parse dollars as a decimal string: never silently round or accept exponents. */
export function parseCheckAmount(value: string): number | null {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [dollars, cents = ""] = value.trim().split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return amount > 0 && amount <= 99_999_999 ? amount : null;
}
export const checkMoney = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
function underThousand(n: number): string {
  if (n < 20) return ones[n];
  if (n < 100) return ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"][Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "");
  return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + underThousand(n % 100) : "");
}
export function checkAmountWords(cents: number): string {
  if (!Number.isInteger(cents) || cents < 1 || cents > 99_999_999) throw Error("Invalid check amount.");
  const dollars = Math.floor(cents / 100);
  const words = dollars < 1000 ? underThousand(dollars) : underThousand(Math.floor(dollars / 1000)) + " Thousand" + (dollars % 1000 ? " " + underThousand(dollars % 1000) : "");
  return words + " and " + String(cents % 100).padStart(2, "0") + "/100";
}
export const checkErrors: Record<string, string> = {
  check_bank_account_locked: "This account’s bank details are configured. Its account digits cannot be changed here.",
  check_bank_details_pending: "Bank account and routing details are pending. You can preview the blank-stock template without reserving a check number.",
  check_stock_in_use: "Checks already use this account's paper format. Create a separate account entry to change formats.",
  check_owner_required: "Only the dealership owner can manage company checks.",
  check_account_missing: "Choose a checking account first.",
  check_missing: "This check is unavailable.",
  check_stale: "This record changed. Refresh the register and review it again.",
  check_number_changed: "The next check number changed. Refresh and match the number to your paper.",
  check_number_used: "That check number is already reserved, including voided checks. Use the next unused sheet.",
  check_retry_conflict: "This request was already saved with different details. Refresh the register before continuing.",
  check_reprint_reason: "Enter a reason to prepare another copy of this check.",
  check_voided: "Voided checks cannot be printed or marked printed.",
  check_pdf_required: "Prepare the print PDF before marking the check printed.",
  check_invalid: "Review the account, check number, date and payment details.",
};
