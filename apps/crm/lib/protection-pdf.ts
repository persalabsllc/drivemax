import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  protectionPlans,
  protectionVersion,
  type ProtectionContract,
} from "./protection";
import { protectionTermsV1 } from "./protection-terms";
import fontkit from "@pdf-lib/fontkit";
export type ProtectionFonts = { regular: Uint8Array; bold: Uint8Array };
const clean = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, " ");
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const ink = rgb(0.12, 0.18, 0.25),
  blue = rgb(0.1, 0.25, 0.4),
  red = rgb(0.76, 0.14, 0.2),
  pale = rgb(0.94, 0.96, 0.98),
  line = rgb(0.76, 0.8, 0.84);
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const rows: string[] = [];
  let row = "";
  for (const word of clean(text).split(/\s+/)) {
    if (font.widthOfTextAtSize(word, size) > width) {
      if (row) {
        rows.push(row);
        row = "";
      }
      let part = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(part + char, size) > width) {
          rows.push(part);
          part = "";
        }
        part += char;
      }
      row = part;
      continue;
    }
    const next = row ? row + " " + word : word;
    if (row && font.widthOfTextAtSize(next, size) > width) {
      rows.push(row);
      row = word;
    } else row = next;
  }
  if (row) rows.push(row);
  return rows;
}
export async function buildProtectionPdf(
  c: ProtectionContract,
  logo?: Uint8Array,
  draft = false,
  cancellationOnly = false,
  fonts?: ProtectionFonts,
) {
  if (c.terms_version !== protectionVersion)
    throw Error(
      "This contract edition is not available. Contact your manager.",
    );
  const pdf = await PDFDocument.create();
  if (fonts) pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(
      fonts?.regular ?? StandardFonts.Helvetica,
      { subset: true },
    ),
    bold = await pdf.embedFont(fonts?.bold ?? StandardFonts.HelveticaBold, {
      subset: true,
    });
  const emblem = logo ? await pdf.embedPng(logo) : null;
  pdf.setTitle(`Drive Max Protection ${draft ? "sample" : c.contract_number}`);
  pdf.setAuthor(c.issuer.name);
  const count = cancellationOnly ? 1 : 5;
  function page(title: string, subtitle: string, number: number) {
    const p = pdf.addPage([612, 792]);
    p.drawRectangle({ x: 0, y: 780, width: 612, height: 12, color: red });
    if (emblem) {
      const d = emblem.scaleToFit(138, 51);
      p.drawImage(emblem, { x: 36, y: 716, width: d.width, height: d.height });
    } else
      p.drawText("DRIVE MAX", {
        x: 36,
        y: 739,
        size: 22,
        font: bold,
        color: blue,
      });
    p.drawText("PROTECTION", {
      x: 335,
      y: 750,
      size: 19,
      font: bold,
      color: blue,
    });
    p.drawText(draft ? "DRAFT - NOT ISSUED" : c.contract_number, {
      x: 335,
      y: 732,
      size: 10,
      font: bold,
      color: ink,
    });
    if (!draft && c.status === "canceled")
      p.drawText("CANCELED COPY", {
        x: 335,
        y: 716,
        size: 10,
        font: bold,
        color: red,
      });
    p.drawText(title, { x: 36, y: 687, size: 19, font: bold, color: blue });
    p.drawText(subtitle, { x: 36, y: 669, size: 9, font: regular, color: ink });
    p.drawLine({
      start: { x: 36, y: 654 },
      end: { x: 576, y: 654 },
      thickness: 1,
      color: line,
    });
    p.drawLine({
      start: { x: 36, y: 39 },
      end: { x: 576, y: 39 },
      thickness: 0.6,
      color: line,
    });
    p.drawText(
      `${draft ? "SAMPLE" : c.contract_number}  |  ${protectionVersion}`,
      { x: 36, y: 25, size: 8, font: regular, color: ink },
    );
    p.drawText(`Page ${number} of ${count}`, {
      x: 519,
      y: 25,
      size: 8,
      font: regular,
      color: ink,
    });
    return p;
  }
  const draw = (
    p: PDFPage,
    text: string,
    x: number,
    y: number,
    size = 10,
    font = regular,
  ) => p.drawText(clean(text), { x, y, size, font, color: ink });
  const p = page(
    cancellationOnly ? "Cancellation statement" : "Vehicle service contract",
    cancellationOnly
      ? "Refund calculation and payment record"
      : "Registration and coverage overview - retain all five pages",
    1,
  );
  let y = 640;
  function band(label: string) {
    p.drawRectangle({ x: 36, y: y - 20, width: 540, height: 20, color: blue });
    p.drawText(label, {
      x: 44,
      y: y - 14,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y -= 20;
  }
  function row(fields: [string, string][], height = 42) {
    const width = 540 / fields.length;
    fields.forEach(([label, value], i) => {
      const x = 36 + i * width;
      p.drawRectangle({
        x,
        y: y - height,
        width,
        height,
        borderColor: line,
        borderWidth: 0.5,
        color: rgb(1, 1, 1),
      });
      draw(p, label, x + 7, y - 12, 7.5);
      let size = 10.5,
        lines = wrap(value || "Not provided", bold, size, width - 14);
      while (lines.length * (size + 2) > height - 20 && size > 7.5) {
        size -= 0.5;
        lines = wrap(value || "Not provided", bold, size, width - 14);
      }
      if (lines.length * (size + 2) > height - 20)
        throw Error(`Shorten the ${label.toLowerCase()} before printing.`);
      lines.forEach((s, j) =>
        draw(p, s, x + 7, y - 25 - j * (size + 2), size, bold),
      );
    });
    y -= height;
  }
  band("VEHICLE AND CONTRACT HOLDER");
  row(
    [
      ["Vehicle identification number (VIN)", c.vin],
      ["Vehicle", `${c.year} ${c.make} ${c.model}`],
    ],
    44,
  );
  row(
    [
      ["Contract holder", c.holder_name],
      ["Co-holder", c.co_holder || "None"],
    ],
    44,
  );
  row([["Address", `${c.address}, ${c.city}, ${c.state} ${c.zip}`]], 44);
  row(
    [
      ["Phone", c.phone],
      ["Email", c.email || "Not provided"],
    ],
    40,
  );
  if (cancellationOnly) {
    if (!c.cancellation) throw Error("This contract has not been canceled.");
    const x = c.cancellation;
    band("CANCELLATION AND REFUND");
    row([
      ["Effective cancellation", x.canceled_on],
      ["Odometer", x.mileage.toLocaleString()],
      ["Original purchase price", money(c.price)],
    ]);
    row([
      ["Elapsed time", `${x.elapsed_days} of ${x.total_days} days`],
      [
        "Miles used",
        `${x.miles_used.toLocaleString()} of ${c.term_miles.toLocaleString()}`,
      ],
      ["Usage applied", `${(x.used * 100).toFixed(2)}%`],
    ]);
    row([
      ["Prorated amount", money(x.prorated)],
      ["Administration fee", money(x.admin_fee)],
      ["Claims paid", money(x.claims_paid)],
    ]);
    row(
      [
        ["Refund due", money(x.refund)],
        ["Payee", x.payee],
      ],
      46,
    );
    row([["Reason", x.reason]], 44);
    row(
      [
        [
          "Payment status",
          x.paid_on
            ? `Recorded paid ${x.paid_on}`
            : "Refund due - payment not recorded",
        ],
        ["Payment reference", x.payment_reference || "None"],
      ],
      46,
    );
    draw(
      p,
      "Recording a cancellation does not send money or contact the lender.",
      36,
      y - 23,
      9,
    );
    draw(
      p,
      "Administration fee is the lesser of $100 or 10% of the prorated amount.",
      36,
      y - 39,
      9,
    );
    return pdf.save();
  }
  band("SELECTED COVERAGE AND EXPIRATION");
  row(
    [
      [
        "Plan",
        `${protectionPlans[c.plan]} - ${c.plan === "deluxe" ? "Powertrain" : "Powertrain + engine accessories"}`,
      ],
      ["Deductible per repair visit", money(c.deductible)],
    ],
    44,
  );
  row(
    [
      ["Issue / coverage start date", c.issued_on],
      ["Starting odometer", `${c.start_miles.toLocaleString()} miles`],
      [
        "Purchased term",
        `${c.term_months} months / ${c.term_miles.toLocaleString()} additional miles`,
      ],
    ],
    46,
  );
  p.drawRectangle({
    x: 36,
    y: y - 39,
    width: 540,
    height: 39,
    color: pale,
    borderColor: line,
    borderWidth: 0.5,
  });
  draw(
    p,
    `EXPIRES ${c.expires_on} OR AT ${c.expires_miles.toLocaleString()} MILES`,
    44,
    y - 16,
    12,
    bold,
  );
  draw(p, "WHICHEVER OCCURS FIRST", 44, y - 31, 8, bold);
  y -= 39;
  row(
    [
      ["Contract purchase price", money(c.price)],
      ["Aggregate covered-repair benefit limit", money(c.claim_limit)],
    ],
    40,
  );
  row(
    [
      ["Lienholder / lender", c.lender || "None recorded"],
      ["Lender address", c.lender_address || "Not provided"],
    ],
    44,
  );
  band("PROVIDER AND CLAIMS ADMINISTRATOR");
  row(
    [
      ["Provider", `${c.issuer.name} | ${c.issuer.address}`],
      ["Prior repair authorization", c.issuer.phone],
    ],
    50,
  );
  const notice =
    "Purchase is optional and is not required to buy a vehicle or obtain financing. By signing, I acknowledge receipt of all five pages, including the selected coverage, exclusions, cancellation rights and benefit limits. No signature is applied electronically by this form.";
  const nlines = wrap(notice, regular, 8.5, 540);
  nlines.forEach((s, i) => draw(p, s, 36, y - 15 - i * 11, 8.5));
  y -= nlines.length * 11 + 27;
  [
    [36, "Contract holder / date"],
    [222, "Co-holder / date"],
    [408, "Dealer representative / date"],
  ].forEach(([x, label]) => {
    p.drawLine({
      start: { x: Number(x), y },
      end: { x: Number(x) + 168, y },
      thickness: 0.6,
      color: ink,
    });
    draw(p, String(label), Number(x), y - 12, 7.5);
  });
  if (y < 58) throw Error("Contract registration exceeds one page.");
  for (const [index, content] of protectionTermsV1.entries()) {
    const sheet = page(content.title, content.subtitle, index + 2);
    let top = 633;
    for (const [heading, body] of content.sections) {
      draw(sheet, heading, 36, top, 10.5, bold);
      top -= 16;
      const rows = wrap(body, regular, 10, 540);
      rows.forEach((s, i) => draw(sheet, s, 36, top - i * 12, 10));
      top -= rows.length * 12 + 12;
    }
    if (top < 46) throw Error(`Contract terms overflow page ${index + 2}.`);
  }
  return pdf.save();
}
