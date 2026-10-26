import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Customer, Quote } from "./model";
import { calculateQuote } from "./finance";
import { productsTotal } from "./operations";
import { fiProductName } from "./fi-menu";

// Deliberate customer-facing allowlist: never serialize the quote object,
// which also contains internal inventory costs and trade ACV.
export function customerQuoteLines(q: Quote, c: Customer): [string, string][] {
  const v = q.values,
    m = calculateQuote(v),
    money = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return [
    ["Prepared for", c.name],
    ["Vehicle", q.vehicle],
    ["Stock", q.vehicle_details?.stock_number || ""],
    ["VIN", q.vehicle_details?.vin || ""],
    ["Vehicle price", money(v.price)],
    ["Accessories / add-ons", money(v.addOns || 0)],
    ["Doc fee", money(v.docFee)],
    ...(v.showProtectionProducts === false
      ? []
      : (v.products?.map(
          (p) =>
            [
              fiProductName(p),
              `${money(p.price)} | ${p.term_months} months / ${p.mileage_limit.toLocaleString()} miles | Deductible ${money(p.deductible)}`,
            ] as [string, string],
        ) ?? [
          ["Protection products", money(productsTotal(v))] as [string, string],
        ])),
    ["Estimated tax", money(m.tax + (v.otherTaxes || 0))],
    ["Title / registration", money(v.titleFee)],
    ["Trade allowance", money(v.tradeAllowance)],
    ["Trade payoff", money(v.payoff)],
    ["Total deal", money(m.total)],
    ["Down payment", money(v.downPayment)],
    ["Estimated balance", money(m.balance)],
    ...(v.mode === "cash"
      ? []
      : ([
          ["Estimated payment", `${money(m.payment)} / month`],
          [
            "Financing",
            `${v.months} months${v.showAPR !== false ? ` at ${v.apr}% APR` : ""}`,
          ],
          [
            "First payment",
            `${v.daysToFirstPayment ?? 30} days after contract`,
          ],
        ] as [string, string][])),
  ];
}
export async function buildCustomerQuotePdf(q: Quote, c: Customer) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, " ");
  let page = pdf.addPage([612, 792]),
    y = 734;
  const heading = () => {
    page.drawText("DRIVE MAX USED CARS", {
      x: 42,
      y,
      font: bold,
      size: 11,
      color: rgb(0.18, 0.25, 0.35),
    });
    y -= 30;
    page.drawText("Customer quote", { x: 42, y, font: bold, size: 24 });
    y -= 22;
    page.drawText(
      `Quote ${q.id.slice(0, 8).toUpperCase()} | Prepared ${q.created_at.slice(0, 10)}`,
      { x: 42, y, font, size: 9 },
    );
    y -= 30;
  };
  heading();
  for (const [label, value] of customerQuoteLines(q, c)) {
    const words = clean(value).split(/\s+/),
      lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, 10) > 345 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    if (y - 14 * lines.length < 85) {
      page = pdf.addPage([612, 792]);
      y = 734;
      heading();
    }
    page.drawText(clean(label), { x: 42, y, font: bold, size: 10 });
    for (const text of lines) {
      page.drawText(text, { x: 210, y, font, size: 10 });
      y -= 14;
    }
    y -= 8;
  }
  if (y < 115) {
    page = pdf.addPage([612, 792]);
    y = 734;
  }
  y -= 14;
  for (const line of [
    "Estimate only. Subject to lender approval, availability and final paperwork.",
    q.values.showProtectionProducts === false
      ? "Totals include any selected coverage. Product details omitted. Not a contract."
      : "Optional protection products are itemized above. This is not a contract.",
  ]) {
    page.drawText(line, {
      x: 42,
      y,
      font,
      size: 9,
      color: rgb(0.35, 0.4, 0.45),
    });
    y -= 14;
  }
  return pdf.save();
}
export async function downloadCustomerQuote(q: Quote, c: Customer) {
  const bytes = await buildCustomerQuotePdf(q, c),
    url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `drive-max-quote-${q.id.slice(0, 8)}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
