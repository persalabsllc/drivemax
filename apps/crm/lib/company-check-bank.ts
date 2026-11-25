import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configuredCheckBank } from "./company-check-bank-config";
import type { CheckAccount } from "./company-checks";

export const checkBank = (orgId: string, account: CheckAccount) => configuredCheckBank(
  process.env.DMCRM_CHECK_BANK, orgId, account, process.env.DMCRM_CHECK_BANK_PURCHASING,
);
export const checkMicrFont = () => readFile(join(process.cwd(), "assets/checks/micr.ttf"));
