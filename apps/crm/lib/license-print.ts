import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
export type LicenseCopy = {
  bytes: Uint8Array;
  name: string;
  capturedAt: string;
  title?: string;
};
export async function appendLicenseCopies(
  base: Uint8Array | null,
  copies: LicenseCopy[],
) {
  const pdf = base ? await PDFDocument.load(base) : await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const copy of copies) {
    const image = await pdf.embedJpg(copy.bytes),
      page = pdf.addPage([612, 792]);
    const name = copy.name.replace(/[^\x20-\x7e]/g, "?").slice(0, 85);
    page.drawText(copy.title ?? "Driver license copy", {
      x: 36,
      y: 748,
      size: 16,
      font,
    });
    page.drawText(name, { x: 36, y: 725, size: 11, font });
    page.drawText(
      `Captured ${copy.capturedAt.slice(0, 10)} | Drive Max customer file`,
      { x: 36, y: 706, size: 9, font, color: rgb(0.35, 0.4, 0.45) },
    );
    const scale = Math.min(540 / image.width, 610 / image.height);
    const width = image.width * scale,
      height = image.height * scale;
    page.drawImage(image, {
      x: (612 - width) / 2,
      y: 55 + (610 - height) / 2,
      width,
      height,
    });
  }
  return pdf.save();
}
