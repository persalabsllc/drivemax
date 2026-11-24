import { z } from "zod";

export const bankConfigSchema = z.object({
  org_id: z.uuid(),
  account_id: z.uuid(),
  routing: z.string().regex(/^\d{9}$/).refine((s) => {
    const digits = [...s].map(Number);
    return Number(s) > 0 && digits.reduce((sum, n, i) => sum + n * [3, 7, 1][i % 3], 0) % 10 === 0;
  }),
  account: z.string().regex(/^\d{4,17}$/),
}).strict();
export type CheckBankConfig = z.infer<typeof bankConfigSchema>;

// Fail closed without exposing configuration values in errors or register responses.
export function configuredCheckBank(raw: string | undefined, orgId: string, account: { id: string; last4: string; bank_ready?: boolean }): CheckBankConfig | null {
  try {
    const parsed = bankConfigSchema.safeParse(JSON.parse(raw || "null"));
    if (!parsed.success || !account.bank_ready) return null;
    const bank = parsed.data;
    return bank.org_id === orgId && bank.account_id === account.id && bank.account.endsWith(account.last4) && account.last4.length === 4 ? bank : null;
  } catch { return null; }
}
