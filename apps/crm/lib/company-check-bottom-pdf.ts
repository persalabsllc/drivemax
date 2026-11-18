import { Duplex, PDFDocument, PrintScaling, StandardFonts, rgb } from "pdf-lib";
import { checkAmountWords, checkBrand, checkErrors, formatCheckNumber, type CheckField, type CheckLayout } from "./company-checks";
import type { PrintableCheck } from "./company-check-pdf";

// VersaCheck #1002: Letter, perforations at 4 and 7.5 inches; 3.5-inch bottom check.
// All artwork stays above the bottom 5/8-inch MICR clear band (page top 747pt).
export const bottomCheckGeometry = { width: 612, height: 792, stubs: [36, 288], checkTop: 540, micrClearTop: 747 } as const;
export async function buildBlankBottomCheckPdf(check: PrintableCheck, layout: CheckLayout, sample: boolean, logo?: Uint8Array) {
  // No guessed routing/account numbers or substitute MICR font. Enable live output only
  // after a later, verified bank/MICR setup is implemented. Previews never reserve numbers.
  if (!sample) throw Error(checkErrors.check_bank_details_pending);
  if (!logo) throw Error("The Drive Max logo could not be loaded. Refresh and try again.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`VOID - Drive Max check ${formatCheckNumber(check.check_number)} - bank details pending`);
  const prefs = pdf.catalog.getOrCreateViewerPreferences();
  prefs.setPrintScaling(PrintScaling.None); prefs.setDuplex(Duplex.Simplex);
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = await pdf.embedPng(logo);
  const ink = rgb(.08, .12, .17), muted = rgb(.30, .36, .42), rule = rgb(.65, .70, .75);
  const text = (value: string, x: number, top: number, width: number, size = 9, strong = false, color = ink) => {
    const face = strong ? bold : font; let fitted = size;
    while (face.widthOfTextAtSize(value, fitted) > width && fitted > 7.5) fitted -= .25;
    if (face.widthOfTextAtSize(value, fitted) > width) throw Error("The check or stub text is too long. Shorten the payee, reference or payment details.");
    page.drawText(value, { x, y: 792 - top - fitted, size: fitted, font: face, color });
  };
  const line = (x: number, top: number, end: number) => page.drawLine({ start: { x, y: 792 - top }, end: { x: end, y: 792 - top }, thickness: .5, color: rule });
  const image = (x: number, top: number, width: number) => { const height = width * brand.height / brand.width; page.drawImage(brand, { x, y: 792 - top - height, width, height }); };
  const number = formatCheckNumber(check.check_number);
  const [yyyy, mm, dd] = check.check_date.split("-"), date = `${mm}/${dd}/${yyyy}`;
  const amount = (check.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const wrap = (value: string, width: number, size: number) => {
    const rows: string[] = [];
    for (const paragraph of value.split("\n")) {
      let current = "";
      for (const word of paragraph.split(/ +/)) {
        const candidate = current ? current + " " + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
        else { if (current) rows.push(current); if (font.widthOfTextAtSize(word, size) > width) throw Error("Break up long words in payment details."); current = word; }
      }
      rows.push(current);
    }
    if (rows.length > 5) throw Error("Payment details need more than five printed lines. Please shorten them.");
    return rows;
  };
  const notes = wrap(check.payment_details || "", 540, 8.5);
  for (const [i, s] of bottomCheckGeometry.stubs.entries()) {
    image(32, s + 12, 107);
    text(checkBrand.company, 155, s + 16, 230, 10, true);
    text(checkBrand.address, 155, s + 31, 230, 8.5);
    text(`${checkBrand.city}  |  ${checkBrand.phone}`, 155, s + 44, 240, 8);
    text(i === 0 ? "PAYEE REMITTANCE" : "COMPANY RECORD", 420, s + 16, 160, 9, true);
    text(`CHECK ${number}  |  ${date}`, 420, s + 33, 160, 9);
    text("VOID PREVIEW", 420, s + 48, 160, 8, true, muted);
    line(32, s + 74, 580);
    text("PAYEE", 32, s + 84, 70, 7, true, muted);
    text(check.payee, 32, s + 97, 400, 11, true);
    text(`$${amount}`, 445, s + 92, 135, 15, true);
    text(`REFERENCE: ${check.reference || "________________________________"}`, 32, s + 119, 276, 9);
    text(`CATEGORY: ${check.category || "________________________"}`, 325, s + 119, 255, 9);
    text(`MEMO: ${check.memo || "_______________________________________________________________"}`, 32, s + 137, 548, 9);
    text("PAYMENT DETAILS / INVOICES / VEHICLE OR STOCK INFORMATION", 32, s + 157, 548, 7, true, muted);
    for (let row = 0; row < 5; row++) {
      text(notes[row] || "", 32, s + 171 + row * 12, 540, 8.5);
      line(32, s + 182 + row * 12, 580);
    }
    text("VOID - TEMPLATE PREVIEW ONLY - NO PAYMENT ISSUED", 32, s + 236, 548, 7, false, muted);
  }
  const s = bottomCheckGeometry.checkTop;
  image(30, s + 15, 90);
  text(checkBrand.company, 130, s + 18, 190, 9, true);
  text(checkBrand.address, 130, s + 32, 190, 8);
  text(checkBrand.city, 130, s + 44, 190, 8);
  text(checkBrand.phone, 130, s + 56, 190, 8);
  text(checkBrand.bank, 340, s + 18, 170, 9, true);
  text(checkBrand.branch, 340, s + 32, 170, 7.5);
  text(checkBrand.bankAddress, 340, s + 43, 170, 7.5);
  text(checkBrand.bankCity, 340, s + 54, 170, 7.5);
  text(number, 529, s + 17, 51, 13, true);
  text("DATE", 426, s + 72, 40, 7, true, muted);
  text("PAY TO THE", 30, s + 93, 58, 7, true, muted);
  text("ORDER OF", 30, s + 103, 58, 7, true, muted);
  text("$", 460, s + 98, 12, 11, true);
  line(92, s + 114, 450); line(477, s + 114, 580);
  line(30, s + 141, 580);
  text("MEMO", 30, s + 194, 30, 7, true, muted);
  line(59, s + 205, 320); line(370, s + 195, 580);
  text("AUTHORIZED SIGNATURE", 370, s + 198, 210, 6.5, false, muted);
  const boxes: Record<CheckField, { x: number; top: number; width: number; size: number }> = {
    date: { x: 470, top: 69, width: 110, size: 10 }, payee: { x: 92, top: 96, width: 358, size: 11 },
    amount: { x: 477, top: 96, width: 103, size: 11 }, words: { x: 30, top: 125, width: 550, size: 9 },
    address: { x: 92, top: 148, width: 270, size: 8.5 }, memo: { x: 59, top: 191, width: 261, size: 9 },
  };
  const values: Record<CheckField, string> = { date, payee: check.payee, amount: `**${amount}**`, words: checkAmountWords(check.amount_cents) + " Dollars ***", address: check.address, memo: check.memo };
  for (const field of Object.keys(boxes) as CheckField[]) {
    const b = boxes[field], off = layout.fields[field], rows = values[field].split("\n");
    const x = b.x + layout.x + off.x, top = b.top + layout.y + off.y;
    if (x < 18 || x + b.width > 594 || top < 15 || s + top + rows.length * 12 > bottomCheckGeometry.micrClearTop) throw Error(`${field}: alignment moves the text outside its printable area. Reduce the adjustment.`);
    rows.forEach((value, i) => text(value, x, s + top + i * 12, b.width, b.size));
  }
  page.drawText("VOID", { x: 399, y: 792 - (s + 167), font: bold, size: 30, color: rgb(.65, .1, .1), opacity: .6 });
  text("BANK DETAILS PENDING - NOT NEGOTIABLE", 370, s + 174, 210, 7, true, muted);
  // Preview guides only; the actual security background comes from the check stock.
  for (const top of [288, 540]) page.drawLine({ start: { x: 18, y: 792 - top }, end: { x: 594, y: 792 - top }, thickness: .5, dashArray: [3, 3], color: rule });
  return pdf.save();
}
