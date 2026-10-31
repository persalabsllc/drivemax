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
  ancillaryProtectionVersion,
  protectionTermLabel,
  type ProtectionContract,
} from "./protection";
import { protectionTermsV1 } from "./protection-terms";
import fontkit from "@pdf-lib/fontkit";
import { ancillaryTerms } from "./protection-ancillary-terms";
import { isMechanicalPlan } from "./protection-programs";
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
  const mechanical = isMechanicalPlan(c.plan);
  if (
    c.terms_version !==
    (mechanical ? protectionVersion : ancillaryProtectionVersion)
  )
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
  const terms = mechanical ? protectionTermsV1 : ancillaryTerms(c);
  const count = cancellationOnly ? 1 : terms.length + 1;
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
      `${draft ? "SAMPLE" : c.contract_number}  |  ${c.terms_version}`,
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
    cancellationOnly
      ? "Cancellation statement"
      : mechanical
        ? "Vehicle service contract"
        : `${protectionPlans[c.plan]} agreement`,
    cancellationOnly
      ? "Refund calculation and payment record"
      : `Registration and coverage overview - retain all ${count} pages`,
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
        c.term_miles === null
          ? "Unlimited - time only"
          : `${x.miles_used.toLocaleString()} of ${c.term_miles.toLocaleString()}`,
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
        mechanical
          ? `${protectionPlans[c.plan]} - ${c.plan === "deluxe" ? "Powertrain" : "Powertrain + engine accessories"}`
          : protectionPlans[c.plan],
      ],
      ["Deductible per repair visit", money(c.deductible)],
    ],
    44,
  );
  row(
    [
      ["Issue / coverage start date", c.issued_on],
      ["Starting odometer", `${c.start_miles.toLocaleString()} miles`],
      ["Purchased term", protectionTermLabel(c)],
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
    c.expires_miles === null
      ? `EXPIRES ${c.expires_on} - UNLIMITED MILEAGE`
      : `EXPIRES ${c.expires_on} OR AT ${c.expires_miles.toLocaleString()} MILES`,
    44,
    y - 16,
    12,
    bold,
  );
  draw(
    p,
    c.expires_miles === null ? "TIME LIMIT ONLY" : "WHICHEVER OCCURS FIRST",
    44,
    y - 31,
    8,
    bold,
  );
  y -= 39;
  row(
    [
      ["Contract purchase price", money(c.price)],
      [
        mechanical
          ? "Aggregate covered-repair benefit limit"
          : "Product benefit limit",
        c.plan === "maintenance"
          ? `${c.maintenance_visits} visits - up to $125 each`
          : c.plan === "key_replacement"
            ? "3 keys total; 2 per rolling 12 months"
            : c.claim_limit === null
              ? "No aggregate dollar limit - see terms"
              : money(c.claim_limit),
      ],
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
  const notice = `Purchase is optional and is not required to buy a vehicle or obtain financing. By signing, I acknowledge receipt of all ${count} pages, including the selected coverage, exclusions, cancellation rights and benefit limits. No signature is applied electronically by this form.`;
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
  for (const [index, content] of terms.entries()) {
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

/** One printing file, with each numbered agreement and its own complete terms. */
export async function buildProtectionPacketPdf(
  contracts: ProtectionContract[],
  logo?: Uint8Array,
  draft = false,
  fonts?: ProtectionFonts,
) {
  if (
    !contracts.length ||
    contracts.length > 30 ||
    new Set(contracts.map((c) => c.id)).size !== contracts.length ||
    contracts.some(
      (c) =>
        c.customer_id !== contracts[0].customer_id ||
        c.vin !== contracts[0].vin,
    )
  )
    throw Error("Select up to 30 contracts for the same customer and vehicle.");
  if (contracts.length === 1)
    return buildProtectionPdf(contracts[0], logo, draft, false, fonts);
  const pdf = await PDFDocument.create();
  if (fonts) pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(
    fonts?.regular ?? StandardFonts.Helvetica,
    { subset: true },
  );
  const bold = await pdf.embedFont(fonts?.bold ?? StandardFonts.HelveticaBold, {
    subset: true,
  });
  const emblem = logo ? await pdf.embedPng(logo) : null;
  const coverCount = Math.ceil(contracts.length / 10);
  const source: PDFDocument[] = [];
  for (const c of contracts)
    source.push(
      await PDFDocument.load(
        await buildProtectionPdf(c, logo, draft, false, fonts),
      ),
    );
  let start = coverCount + 1;
  const starts = source.map((p) => {
    const n = start;
    start += p.getPageCount();
    return n;
  });
  const count = start - 1;
  for (let sheet = 0; sheet < coverCount; sheet++) {
    const p = pdf.addPage([612, 792]);
    const draw = (s: string, x: number, y: number, size = 10, font = regular) =>
      p.drawText(clean(s), { x, y, size, font, color: ink });
    p.drawRectangle({ x: 0, y: 780, width: 612, height: 12, color: red });
    if (emblem) {
      const d = emblem.scaleToFit(138, 51);
      p.drawImage(emblem, { x: 36, y: 716, width: d.width, height: d.height });
    }
    draw("PROTECTION PACKET", 285, 741, 19, bold);
    draw(
      draft
        ? "DRAFT - NOT ISSUED"
        : `${contracts.length} individual agreements`,
      285,
      719,
      10,
      bold,
    );
    draw("Your selected coverage", 36, 679, 21, bold);
    function fitted(text: string, y: number, font: PDFFont, initial: number) {
      let size = initial;
      while (font.widthOfTextAtSize(clean(text), size) > 540 && size > 7.5)
        size -= 0.5;
      if (font.widthOfTextAtSize(clean(text), size) > 540)
        throw Error(
          "Shorten the packet holder or vehicle description before printing.",
        );
      draw(text, 36, y, size, font);
    }
    fitted(contracts[0].holder_name, 655, bold, 11);
    fitted(
      `VIN ${contracts[0].vin}  |  ${contracts[0].year} ${contracts[0].make} ${contracts[0].model}`,
      637,
      regular,
      9,
    );
    p.drawRectangle({ x: 36, y: 597, width: 540, height: 25, color: pale });
    draw("PRODUCT / CONTRACT", 44, 606, 8, bold);
    draw("PRICE", 291, 606, 8, bold);
    draw("EXPIRES", 379, 606, 8, bold);
    draw("PAGES", 521, 606, 8, bold);
    let y = 579;
    contracts.slice(sheet * 10, sheet * 10 + 10).forEach((c, j) => {
      const index = sheet * 10 + j;
      draw(protectionPlans[c.plan], 44, y, 10, bold);
      draw(
        draft
          ? "DRAFT"
          : `${c.contract_number}${c.status === "canceled" ? " - CANCELED" : ""}`,
        44,
        y - 15,
        8,
      );
      draw(money(c.price), 291, y, 10, bold);
      draw(c.expires_on, 379, y, 9);
      draw(
        c.expires_miles === null
          ? "Unlimited miles"
          : `${c.expires_miles.toLocaleString()} miles`,
        379,
        y - 15,
        8,
      );
      draw(
        `${starts[index]}-${starts[index] + source[index].getPageCount() - 1}`,
        521,
        y,
        9,
      );
      p.drawLine({
        start: { x: 36, y: y - 25 },
        end: { x: 576, y: y - 25 },
        thickness: 0.5,
        color: line,
      });
      y -= 46;
    });
    const total = contracts.reduce((n, c) => n + c.price, 0);
    draw(`Total contract prices: ${money(total)}`, 36, y - 3, 12, bold);
    const note =
      "Each product has its own agreement, signature, benefits, expiration and cancellation calculation. This index is not a substitute for the complete terms that follow. Purchase is optional and is not required to purchase or finance a vehicle.";
    wrap(note, regular, 9, 540).forEach((s, i) =>
      draw(s, 36, y - 30 - i * 12, 9),
    );
    draw(
      `Drive Max Protection | Packet index ${sheet + 1} of ${coverCount} | ${count} total pages`,
      36,
      26,
      8,
    );
  }
  for (const doc of source)
    for (const page of await pdf.copyPages(doc, doc.getPageIndices()))
      pdf.addPage(page);
  pdf.setTitle("Drive Max Protection - selected contracts");
  pdf.setAuthor(contracts[0].issuer.name);
  return pdf.save();
}
