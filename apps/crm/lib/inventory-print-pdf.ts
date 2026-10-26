import {
  PDFDocument,
  StandardFonts,
  PrintScaling,
  Duplex,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  printMaterialsSchema,
  printVehicleSchema,
  stickerTotal,
  type PrintMaterialsDraft,
  type PrintVehicle,
} from "./inventory-print";

const black = rgb(0, 0, 0);
const navy = rgb(0.08, 0.14, 0.2);
const red = rgb(0.69, 0.12, 0.15);
const muted = rgb(0.32, 0.37, 0.42);
const currency = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

function printable(value: string, font: PDFFont, label: string) {
  const text = value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\t/g, " ");
  try {
    font.encodeText(text.replace(/\r?\n/g, " "));
  } catch {
    throw new Error(
      `${label} contains a character this print font cannot display. Use standard English characters before printing.`,
    );
  }
  return text;
}

// Keep every field inside its allotted space. Never truncate warranty wording.
function textBox(
  page: PDFPage,
  value: string,
  font: PDFFont,
  box: {
    x: number;
    top: number;
    width: number;
    height: number;
    size: number;
    min?: number;
    label: string;
    color?: ReturnType<typeof rgb>;
  },
) {
  const text = printable(value, font, box.label);
  for (let size = box.size; size >= (box.min ?? box.size); size -= 0.5) {
    const lines: string[] = [];
    let fits = true;
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (font.widthOfTextAtSize(word, size) > box.width) {
          fits = false;
          break;
        }
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > box.width) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    const leading = size * 1.22;
    if (fits && (lines.length - 1) * leading + size <= box.height) {
      lines.forEach((line, i) =>
        page.drawText(line, {
          x: box.x,
          y: 792 - box.top - size - i * leading,
          size,
          font,
          color: box.color ?? black,
        }),
      );
      return;
    }
  }
  throw new Error(
    `${box.label} is too long to fit legibly. Shorten it before printing.`,
  );
}

function check(page: PDFPage, x: number, top: number, size: number) {
  const inset = size > 10 ? 4 : 1.5;
  page.drawLine({
    start: { x: x + inset, y: 792 - top - inset },
    end: { x: x + size - inset, y: 792 - top - size + inset },
    thickness: size > 10 ? 1.8 : 1,
    color: black,
  });
  page.drawLine({
    start: { x: x + inset, y: 792 - top - size + inset },
    end: { x: x + size - inset, y: 792 - top - inset },
    thickness: size > 10 ? 1.8 : 1,
    color: black,
  });
}

export type PrintAssetLoader = (path: string) => Promise<Uint8Array>;
const fetchAsset: PrintAssetLoader = async (path) => {
  const response = await fetch(path);
  if (!response.ok)
    throw new Error(
      "A print template could not be loaded. Check your connection and try again.",
    );
  return new Uint8Array(await response.arrayBuffer());
};

/** All edits are local to the generated PDF; this function performs no writes. */
export async function buildInventoryPrintPdf(
  vehicleInput: PrintVehicle,
  draft: PrintMaterialsDraft,
  load: PrintAssetLoader = fetchAsset,
) {
  const vehicle = printVehicleSchema.parse(vehicleInput);
  const options = printMaterialsSchema.parse(draft);
  const [logoBytes, guideBytes] = await Promise.all([
    options.sticker ? load("/print-materials/drive-max-logo.png") : undefined,
    options.buyersGuide
      ? load("/print-materials/ftc-buyers-guide-en.pdf")
      : undefined,
  ]);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(
    `${vehicle.year} ${vehicle.make} ${vehicle.model} - ${options.dealerName}`,
  );
  pdf.setAuthor(options.dealerName);
  pdf.setSubject("Vehicle print materials");

  if (options.sticker && logoBytes) {
    const page = pdf.addPage([612, 792]);
    const logo = await pdf.embedPng(logoBytes);
    const imageSize = logo.scaleToFit(192, 96);
    page.drawImage(logo, {
      x: 36,
      y: 792 - 33 - imageSize.height,
      ...imageSize,
    });
    const put = (
      value: string,
      x: number,
      top: number,
      width: number,
      height: number,
      size: number,
      label: string,
      strong = false,
      color = navy,
      min = size,
    ) =>
      textBox(page, value, strong ? bold : font, {
        x,
        top,
        width,
        height,
        size,
        label,
        color,
        min,
      });
    put(
      options.dealerName,
      284,
      45,
      292,
      30,
      13,
      "Dealer name",
      true,
      navy,
      10,
    );
    put(
      options.address,
      284,
      80,
      292,
      28,
      10,
      "Dealer address",
      false,
      muted,
      9,
    );
    put(options.phone, 284, 113, 292, 17, 12, "Dealer phone", true);
    page.drawLine({
      start: { x: 36, y: 646 },
      end: { x: 576, y: 646 },
      thickness: 2,
      color: red,
    });
    put("PRE-OWNED VEHICLE", 36, 164, 540, 14, 10, "Heading", true, red);
    put(
      `${vehicle.year} ${vehicle.make}\n${vehicle.model}`,
      36,
      190,
      540,
      94,
      34,
      "Vehicle name",
      true,
      navy,
      22,
    );
    put(
      vehicle.trim || "",
      36,
      287,
      540,
      20,
      14,
      "Vehicle trim",
      false,
      muted,
      10,
    );

    const fact = (
      label: string,
      value: string,
      x: number,
      top: number,
      width: number,
    ) => {
      put(
        label.toUpperCase(),
        x,
        top,
        width,
        12,
        8,
        "Field label",
        true,
        muted,
      );
      put(
        value || "Not specified",
        x,
        top + 17,
        width,
        25,
        13,
        label,
        true,
        navy,
        9,
      );
    };
    fact("Stock number", vehicle.stock_number, 36, 326, 255);
    fact(
      "Mileage",
      `${vehicle.mileage.toLocaleString("en-US")} miles`,
      321,
      326,
      255,
    );
    fact("VIN", vehicle.vin, 36, 382, 255);
    fact("Exterior color", vehicle.color, 321, 382, 255);

    page.drawRectangle({
      x: 36,
      y: 792 - 446 - 150,
      width: 540,
      height: 150,
      color: rgb(0.95, 0.96, 0.97),
      borderColor: rgb(0.87, 0.89, 0.91),
      borderWidth: 0.7,
    });
    put("TOTAL ASKING PRICE", 56, 463, 500, 18, 11, "Price label", true, muted);
    put(
      currency(stickerTotal(options.price, options.administrationFee)),
      56,
      487,
      500,
      63,
      52,
      "Total asking price",
      true,
      navy,
      40,
    );
    put(
      `Vehicle price ${currency(options.price)}  +  Dealer administration fee ${currency(options.administrationFee)}`,
      56,
      558,
      500,
      26,
      10,
      "Price itemization",
      false,
      muted,
      9,
    );

    if (options.highlights) {
      put(
        "VEHICLE HIGHLIGHTS",
        36,
        618,
        540,
        14,
        9,
        "Highlights heading",
        true,
        red,
      );
      put(
        options.highlights,
        36,
        640,
        540,
        62,
        11,
        "Vehicle highlights",
        false,
        navy,
        9,
      );
    } else {
      put(
        "LET'S FIND YOUR NEXT DRIVE.",
        36,
        627,
        540,
        25,
        18,
        "Footer heading",
        true,
      );
      put(
        "Ask our team about this vehicle and available protection options.",
        36,
        662,
        540,
        25,
        11,
        "Footer message",
        false,
        muted,
      );
    }
    page.drawLine({
      start: { x: 36, y: 77 },
      end: { x: 576, y: 77 },
      thickness: 0.7,
      color: rgb(0.82, 0.85, 0.88),
    });
    put(options.website, 36, 727, 300, 17, 12, "Dealer website", true, red, 9);
    put(options.phone, 365, 727, 211, 17, 12, "Dealer phone", true);
    put(
      "Excludes tax, title and registration. Optional products cost extra. See Buyers Guide for warranty terms.",
      36,
      755,
      540,
      17,
      8,
      "Price disclosure",
      false,
      muted,
    );
    // With duplex printing, preserve a separate sticker and a two-sided Guide.
    if (options.buyersGuide) pdf.addPage([612, 792]);
  }

  if (options.buyersGuide && guideBytes) {
    const source = await PDFDocument.load(guideBytes);
    const [front, back] = await pdf.copyPages(source, [
      options.warranty === "implied" ? 1 : 0,
      2,
    ]);
    pdf.addPage(front);
    pdf.addPage(back);
    const put = (
      page: PDFPage,
      value: string,
      x: number,
      top: number,
      width: number,
      height: number,
      size: number,
      label: string,
      min = size,
    ) =>
      textBox(page, value, font, { x, top, width, height, size, label, min });
    put(front, vehicle.make, 81, 132, 113, 16, 11, "Vehicle make", 8);
    put(front, vehicle.model, 203.5, 132, 82, 16, 10, "Vehicle model", 8);
    put(front, String(vehicle.year), 294.5, 132, 45, 16, 11, "Vehicle year");
    put(front, vehicle.vin, 355, 133, 177, 16, 10, "Vehicle VIN", 9);
    if (options.warranty === "dealer") {
      check(front, 81, 246, 22);
      check(front, 94.8, options.warrantyType === "limited" ? 296 : 278, 8);
      if (options.warrantyType === "limited") {
        put(
          front,
          String(options.labor),
          277,
          293,
          20,
          10,
          8,
          "Labor percentage",
          7,
        );
        put(
          front,
          String(options.parts),
          365.3,
          293,
          20,
          10,
          8,
          "Parts percentage",
          7,
        );
      }
      put(front, options.systems, 81, 367, 217, 64, 9, "Covered systems", 8);
      put(
        front,
        options.duration,
        312.7,
        367,
        218,
        64,
        10,
        "Warranty duration",
        9,
      );
    } else check(front, 81, 196, 22);
    if (options.manufacturerWarranty) check(front, 81, 463.2, 8);
    if (options.manufacturerUsedWarranty) check(front, 81, 486.8, 8);
    if (options.otherUsedWarranty) check(front, 81, 503.3, 8);
    if (options.serviceContract) check(front, 81, 553, 8);
    put(back, options.dealerName, 81, 559, 450, 13, 10, "Dealer name", 9);
    put(back, options.address, 81, 584, 450, 13, 10, "Dealer address", 9);
    put(back, options.phone, 81, 609, 215, 13, 10, "Dealer phone", 9);
    put(back, options.email, 306, 609, 225, 13, 10, "Dealer email", 8);
    put(
      back,
      `${options.complaintsContact} | ${options.phone}`,
      81,
      659,
      450,
      13,
      10,
      "Complaints contact",
      8,
    );
  }
  // Letter size at 100%, duplex long edge when printing a Guide.
  const preferences = pdf.catalog.getOrCreateViewerPreferences();
  preferences.setPrintScaling(PrintScaling.None);
  preferences.setDuplex(
    options.buyersGuide ? Duplex.DuplexFlipLongEdge : Duplex.Simplex,
  );
  return pdf.save();
}
