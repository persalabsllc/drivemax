import { bankConfigSchema } from "./company-check-bank-config";
import { checkErrors, formatCheckNumber } from "./company-checks";

export type MicrBank = { routing: string; account: string; font: Uint8Array };
// DGL MICR Encoding: 2048-unit advance / 4096 UPM at 18pt = 9pt pitch.
// Field positions count from the check's right edge. Amount field remains blank.
// Keep actual glyph ink above a 1/4-inch printer margin, with 1/32-inch
// clearance. This font's ink spans 0–8.41pt above the baseline, so the whole
// line stays inside the MICR print strip (13.5–31.5pt from the bottom edge).
// The security paper's colored border is not the MICR alignment reference.
export const micrGeometry = { size: 18, pitch: 9, baseline: 20.25, rightInset: 22.5 } as const;
export function checkMicrFields(bank: Pick<MicrBank, "routing" | "account">, number: number) {
  if (!bankConfigSchema.pick({ routing: true, account: true }).safeParse(bank).success || !Number.isInteger(number) || number < 1 || number > 999999998) throw Error(checkErrors.check_bank_details_pending);
  return [
    { text: `C${formatCheckNumber(number)}C`, endPosition: 46, endInk: 1740 },
    { text: `A${bank.routing}A`, endPosition: 33, endInk: 1731 },
    { text: `${bank.account}C`, endPosition: 14, endInk: 1740 },
  ].map(({ text, endPosition, endInk }) => ({
    text, endPosition,
    x: 612 - micrGeometry.rightInset - (endPosition - 1) * micrGeometry.pitch - (text.length - 1) * micrGeometry.pitch - endInk / 4096 * micrGeometry.size,
    y: micrGeometry.baseline,
  }));
}
