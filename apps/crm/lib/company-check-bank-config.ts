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
export function configuredCheckBank(
  primary: string | undefined,
  orgId: string,
  account: { id: string; last4: string; bank_ready?: boolean },
  ...additional: (string | undefined)[]
): CheckBankConfig | null {
  if (!account.bank_ready || !/^\d{4}$/.test(account.last4)) return null;
  let match: CheckBankConfig | null = null;
  for (const raw of [primary, ...additional]) {
    if (!raw) continue;
    let candidate;
    try { candidate = JSON.parse(raw); } catch { continue; }
    if (candidate?.org_id !== orgId || candidate?.account_id !== account.id) continue;
    const parsed = bankConfigSchema.safeParse(candidate);
    if (match || !parsed.success || !parsed.data.account.endsWith(account.last4)) return null;
    match = parsed.data;
  }
  return match;
}
