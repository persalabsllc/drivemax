import {
  PDFDocument,
  PDFName,
  PDFTextField,
  PDFCheckBox,
  StandardFonts,
  rgb,
  type PDFFont,
} from "pdf-lib";
import {
  fieldKey,
  type FormTemplate,
  type FormField,
  type PaperValues,
  type Paperwork,
  formValues,
  mvr2Form,
  soldForms,
} from "./documents";
type Loader = (form: FormTemplate) => Promise<Uint8Array>;
function printable(s: string, label: string) {
  const text = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
  if (/[^\x20-\x7e\xa0-\xff\n\r]/.test(text))
    throw new Error(
      `${label}: this form font cannot print one of the characters. Review that field before printing.`,
    );
  return text;
}
function fittedSize(text: string, f: FormField, font: PDFFont, label: string) {
  const width = f.width - 4,
    height = f.height - 3;
  for (
    let size = Math.min(f.fontSize, Math.max(5, height));
    size >= 4.5;
    size -= 0.25
  ) {
    if (!f.multiline) {
      if (!text.includes("\n") && font.widthOfTextAtSize(text, size) <= width)
        return size;
    } else {
      let count = 0;
      for (const paragraph of text.split(/\r?\n/)) {
        let line = "";
        count++;
        for (const word of paragraph.split(/\s+/)) {
          if (font.widthOfTextAtSize(word, size) > width) {
            count = 10000;
            break;
          }
          const next = line ? line + " " + word : word;
          if (font.widthOfTextAtSize(next, size) > width) {
            count++;
            line = word;
          } else line = next;
        }
      }
      if (count * size * 1.2 <= height) return size;
    }
  }
  throw new Error(
    `${label}: the text is too long for this field. Shorten it in the preview before printing.`,
  );
}
export async function buildSoldPack(
  context: PaperValues,
  paperwork: Paperwork,
  load: Loader,
) {
  const packet = await PDFDocument.create();
  packet.setTitle("Drive Max sold pack");
  packet.setAuthor("Drive Max");
  for (const spec of soldForms) {
    const pdf = await PDFDocument.load(await load(spec)),
      font = await pdf.embedFont(StandardFonts.Helvetica),
      form = pdf.getForm(),
      values = formValues(spec, context, paperwork);
    for (const f of spec.pages.flatMap((p) => p.fields)) {
      const value = values[fieldKey(f)];
      if (f.radioGroup) {
        if (value === true)
          form.getRadioGroup(f.radioGroup).select(f.exportValue!);
        continue;
      }
      const field = form.getFieldMaybe(f.name);
      if (!field)
        throw new Error(`Template field missing: ${spec.title} / ${f.label}`);
      if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFTextField) {
        const label = spec.title + " / " + f.label,
          text = printable(String(value ?? ""), label);
        field.setText(text);
        if (f.multiline) field.enableMultiline();
        field.setFontSize(fittedSize(text, f, font, label));
      }
    }
    form.updateFieldAppearances(font);
    form.flatten();
    for (const page of pdf.getPages()) page.node.delete(PDFName.of("Annots"));
    for (const page of await packet.copyPages(pdf, pdf.getPageIndices()))
      packet.addPage(page);
  }
  return packet.save();
}
export async function buildMvr2(
  context: PaperValues,
  paperwork: Paperwork,
  load: Loader,
  test = false,
) {
  const cal = paperwork.$mvr2 ?? {},
    section = Math.min(3, Math.max(1, Number(cal.section) || 1)),
    scale = Math.min(1.05, Math.max(0.95, (Number(cal.scale) || 100) / 100)),
    dx = Math.min(36, Math.max(-36, Number(cal.x) || 0)),
    dy = Math.min(36, Math.max(-36, Number(cal.y) || 0));
  const spec = mvr2Form.pages[0],
    pdf = await PDFDocument.create(),
    page = pdf.addPage([spec.width, spec.height]),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    values = formValues(mvr2Form, context, paperwork, section);
  pdf.setTitle(
    test
      ? "MVR-2 alignment test - plain paper"
      : "MVR-2 text overlay - preprinted form",
  );
  if (test) {
    const [background] = await pdf.embedPdf(await load(mvr2Form), [0]);
    page.drawPage(background);
  }
  for (const f of spec.fields) {
    if (f.section && f.section !== section) continue;
    let text =
      f.type === "checkbox"
        ? values[fieldKey(f)] === true
          ? "X"
          : ""
        : printable(String(values[fieldKey(f)] ?? ""), "MVR-2 / " + f.label);
    if (!text) continue;
    const size = fittedSize(
      text,
      { ...f, height: f.height + 2 },
      font,
      "MVR-2 / " + f.label,
    );
    page.drawText(text, {
      x: f.x * scale + dx,
      y:
        spec.height -
        (f.y + f.height) * scale -
        dy +
        Math.max(0, (f.height - size) / 2) * scale,
      size: size * scale,
      font,
      color: rgb(0, 0, 0),
    });
  }
  if (test)
    page.drawText("ALIGNMENT TEST - PLAIN PAPER ONLY", {
      x: 165,
      y: 5,
      size: 8,
      font,
      color: rgb(0.7, 0, 0),
    });
  return pdf.save();
}
