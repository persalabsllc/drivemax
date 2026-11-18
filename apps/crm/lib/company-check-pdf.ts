import { Duplex, PDFDocument, PrintScaling, StandardFonts, rgb } from "pdf-lib";
import { checkAmountWords, checkDetailsSchema, checkLayoutSchema, defaultCheckLayout, formatCheckNumber, isBlankCheckStock, type CheckDetails, type CheckField, type CheckLayout } from "./company-checks";
import { buildBlankBottomCheckPdf } from "./company-check-bottom-pdf";

export type PrintableCheck = CheckDetails & { check_number: number; account_name: string; account_last4: string };
// US Letter, top check (3.5 inches), two remittance stubs. All values in points.
export const checkBoxes: Record<CheckField, { x: number; top: number; width: number; size: number }> = {
  date: { x: 470, top: 51, width: 106, size: 11 },
  payee: { x: 60, top: 86, width: 390, size: 12 },
  amount: { x: 482, top: 86, width: 94, size: 12 },
  words: { x: 30, top: 113, width: 525, size: 11 },
  address: { x: 60, top: 144, width: 360, size: 10 },
  memo: { x: 55, top: 192, width: 260, size: 10 },
};
export const sampleCheck: PrintableCheck = {
  payee: "SAMPLE PAYEE", amount_cents: 123456, check_date: "2026-01-15", memo: "Alignment sample only",
  address: "123 Sample Street\nSample City, NC 00000", check_number: 0, account_name: "Sample account", account_last4: "",
};
export async function buildCompanyCheckPdf(check: PrintableCheck, layout: CheckLayout = defaultCheckLayout, sample = false, logo?: Uint8Array) {
  checkDetailsSchema.parse({ payee: check.payee, amount_cents: check.amount_cents, check_date: check.check_date, memo: check.memo, address: check.address, reference: check.reference, category: check.category, payment_details: check.payment_details });
  checkLayoutSchema.parse(layout);
  if (isBlankCheckStock(layout)) return buildBlankBottomCheckPdf(check, layout, sample, logo);
  const pdf = await PDFDocument.create();
  pdf.setTitle(sample ? "VOID - Company check alignment sample" : `Drive Max check ${formatCheckNumber(check.check_number)}`);
  const prefs = pdf.catalog.getOrCreateViewerPreferences();
  prefs.setPrintScaling(PrintScaling.None);
  prefs.setDuplex(Duplex.Simplex);
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [year, month, day] = check.check_date.split("-");
  const date = `${month}/${day}/${year}`;
  const amount = (check.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fieldValues: Record<CheckField, string> = { date, payee: check.payee, amount: `**${amount}**`, words: checkAmountWords(check.amount_cents) + " ***", address: check.address, memo: check.memo };
  for (const field of Object.keys(checkBoxes) as CheckField[]) {
    const box = checkBoxes[field], adjustment = layout.fields[field];
    const x = box.x + layout.x + adjustment.x, top = box.top + layout.y + adjustment.y;
    const lines = fieldValues[field].split("\n");
    let size = box.size;
    while (size > 8 && lines.some((s) => font.widthOfTextAtSize(s, size) > box.width)) size -= .25;
    if (lines.some((s) => font.widthOfTextAtSize(s, size) > box.width)) throw Error(`${field}: the text is too long to print clearly. Shorten it before saving.`);
    // Protect paper margins and the preprinted MICR band at the bottom of the check.
    if (x < 18 || x + box.width > 594 || top < 18 || top + lines.length * 12 > 216) throw Error(`${field}: alignment moves the text outside its printable area. Reduce the adjustment.`);
    lines.forEach((text, i) => page.drawText(text, { x, y: 792 - top - size - i * 12, size, font, color: rgb(0, 0, 0) }));
  }
  for (const [i, top] of [252, 504].entries()) {
    const draw = (text: string, y: number, size = 10, strong = false) => {
      let fitted = size;
      const face = strong ? bold : font;
      while (face.widthOfTextAtSize(text, fitted) > 540 && fitted > 8) fitted -= .25;
      if (face.widthOfTextAtSize(text, fitted) > 540) throw Error("The stub text is too long to print clearly.");
      page.drawText(text, { x: 36, y: 792 - top - y, size: fitted, font: face });
    };
    draw("DRIVE MAX USED CARS LLC", 30, 11, true);
    draw(`${i === 0 ? "Payee" : "Company"} copy  |  Check #${formatCheckNumber(check.check_number)}  |  ${date}`, 50);
    draw(`Pay to: ${check.payee}`, 75, 11, true);
    draw(`Amount: $${amount}`, 97, 11, true);
    draw(`Memo: ${check.memo || "-"}`, 121);
    draw(`Account: ${check.account_name}${check.account_last4 ? " (ending " + check.account_last4 + ")" : ""}`, 143);
    draw(`Reference: ${check.reference || "-"} | Category: ${check.category || "-"}`, 161, 9);
    if (check.payment_details) draw(check.payment_details.replace(/\n/g, " "), 178, 8);
    if (sample) draw("VOID - ALIGNMENT SAMPLE - PRINT ON PLAIN PAPER", 180, 11, true);
  }
  if (sample) {
    page.drawText("VOID - ALIGNMENT SAMPLE", { x: 180, y: 760, size: 16, font: bold, color: rgb(.65, .1, .1) });
    for (const y of [252, 504]) page.drawLine({ start: { x: 18, y: 792 - y }, end: { x: 594, y: 792 - y }, thickness: .5, dashArray: [3, 3], color: rgb(.7, .7, .7) });
  }
  return pdf.save();
}
