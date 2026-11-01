import { z } from "zod";

export const lenderFinanceSchema = z.object({
  lender: z.string().trim().max(250),
  buyRate: z.number().finite().min(0).max(50).nullable(),
  payoutPercent: z.number().finite().min(0).max(100).multipleOf(0.01),
  reserveOverride: z.number().finite().min(0).max(1_000_000).nullable(),
  lenderFees: z.number().finite().min(0).max(1_000_000),
});
