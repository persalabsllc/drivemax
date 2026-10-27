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
    const white = rgb(1, 1, 1),
      pale = rgb(0.95, 0.955, 0.96),
      rule = rgb(0.72, 0.75, 0.78);
    const specs = options.specifications;
    const rectangle = (
      x: number,
      top: number,
      width: number,
      height: number,
      fill = white,
      border = rule,
      weight = 0.6,
    ) =>
      page.drawRectangle({
        x,
        y: 792 - top - height,
        width,
        height,
        color: fill,
        borderColor: border,
        borderWidth: weight,
      });
    const line = (
      x: number,
      top: number,
      endX: number,
      endTop: number,
      color = rule,
      thickness = 0.6,
    ) =>
      page.drawLine({
        start: { x, y: 792 - top },
        end: { x: endX, y: 792 - endTop },
        color,
        thickness,
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
    const section = (
      title: string,
      x: number,
      top: number,
      width: number,
      height: number,
    ) => {
      rectangle(x, top, width, height);
      rectangle(x, top, width, 23, pale, rule);
      rectangle(x, top, 4, 23, red, red, 0);
      put(title, x + 12, top + 6, width - 24, 12, 9, title, true);
    };

    // A restrained, dealership-style frame stays crisp in color or grayscale.
    rectangle(24, 24, 564, 744, white, navy, 1.2);
    rectangle(29, 29, 554, 734, white, rule, 0.35);
    rectangle(24, 24, 564, 5, red, red, 0);
    const logo = await pdf.embedPng(logoBytes);
    const imageSize = logo.scaleToFit(187, 68);
    page.drawImage(logo, {
      x: 43,
      y: 792 - 40 - imageSize.height,
      ...imageSize,
    });
    put(options.dealerName, 268, 43, 300, 20, 12, "Dealer name", true, navy, 9);
    put(
      options.address,
      268,
      68,
      300,
      25,
      9,
      "Dealer address",
      false,
      muted,
      8,
    );
    put(options.phone, 268, 96, 200, 14, 11, "Dealer phone", true);
    line(36, 118, 576, 118, red, 2);
    for (let i = 0; i < 4; i++)
      line(529 + i * 11, 108, 535 + i * 11, 98, red, 3);

    rectangle(36, 131, 540, 87, navy, navy, 0);
    put(
      `${vehicle.year} ${vehicle.make.toUpperCase()}`,
      49,
      141,
      365,
      20,
      14,
      "Year and make",
      true,
      white,
      10,
    );
    put(vehicle.model, 48, 162, 365, 34, 29, "Vehicle model", true, white, 16);
    put(
      vehicle.trim || "PRE-OWNED VEHICLE",
      49,
      199,
      365,
      13,
      10,
      "Vehicle trim",
      false,
      white,
      8,
    );
    line(429, 145, 429, 204, rgb(0.4, 0.45, 0.5), 0.7);
    put("STOCK NUMBER", 443, 146, 119, 10, 7, "Stock label", true, white);
    put(
      vehicle.stock_number,
      443,
      160,
      119,
      20,
      13,
      "Stock number",
      true,
      white,
      8,
    );
    put(
      `${vehicle.mileage.toLocaleString("en-US")} miles`,
      443,
      190,
      119,
      17,
      11,
      "Mileage",
      true,
      white,
      8,
    );
    put(`VIN  ${vehicle.vin}`, 43, 229, 309, 14, 10, "VIN", true);
    put(
      `COLOR  ${vehicle.color || "Not listed"}`,
      365,
      229,
      204,
      14,
      9,
      "Exterior color",
      false,
      muted,
      8,
    );

    section("VEHICLE SPECIFICATIONS", 36, 256, 328, 136);
    const fact = (
      label: string,
      val: string,
      x: number,
      top: number,
      width: number,
    ) => {
      put(label, x, top, width, 9, 6.7, `${label} label`, true, muted);
      put(
        val || "Not listed",
        x,
        top + 11,
        width,
        20,
        10,
        label,
        true,
        navy,
        7.5,
      );
    };
    fact("ENGINE", specs.engine, 48, 287, 151);
    fact(
      "HORSEPOWER",
      specs.horsepower ? `${specs.horsepower} hp` : "",
      214,
      287,
      137,
    );
    line(48, 319, 352, 319, rule, 0.35);
    fact("TRANSMISSION", specs.transmission, 48, 324, 151);
    fact("DRIVETRAIN", specs.drivetrain, 214, 324, 137);
    line(48, 356, 352, 356, rule, 0.35);
    fact("FUEL TYPE", specs.fuel, 48, 361, 151);
    fact("BODY STYLE", specs.body, 214, 361, 137);

    const hasEconomy = !!(
      specs.cityMpg ||
      specs.highwayMpg ||
      specs.combinedMpg
    );
    section(
      specs.epaId && hasEconomy ? "EPA FUEL ECONOMY" : "FUEL ECONOMY",
      376,
      256,
      200,
      136,
    );
    if (hasEconomy) {
      const cells = [
        ["CITY", specs.cityMpg],
        ["COMBINED", specs.combinedMpg],
        ["HIGHWAY", specs.highwayMpg],
      ];
      cells.forEach(([label, val], i) => {
        const x = 387 + i * 62;
        put(
          val || "--",
          x,
          287,
          58,
          34,
          i === 1 ? 30 : 26,
          `${label} economy`,
          true,
          i === 1 ? red : navy,
          20,
        );
        put(label, x, 324, 58, 10, 7, `${label} economy label`, true, muted);
      });
      line(388, 341, 564, 341, rule, 0.5);
      put(
        `${specs.economyUnit} · ${specs.economyFuel || specs.fuel || "Fuel economy"}`,
        388,
        348,
        176,
        25,
        9,
        "Rating units and fuel",
        true,
        navy,
        7.5,
      );
      put(
        "Actual mileage will vary.",
        388,
        377,
        176,
        10,
        7,
        "Mileage disclaimer",
        false,
        muted,
      );
    } else {
      put(
        "RATINGS NOT LISTED",
        390,
        300,
        170,
        16,
        11,
        "Unavailable economy",
        true,
        muted,
      );
      put(
        "Ask our team for fuel-economy information on this vehicle.",
        390,
        332,
        170,
        38,
        9,
        "Economy information",
        false,
        muted,
      );
    }

    section("FEATURES & EQUIPMENT", 36, 406, 540, 153);
    const features = specs.features
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (features.length) {
      const rows = Math.ceil(features.length / 2);
      const spacing = Math.min(34, 114 / rows);
      features.forEach((feature, i) => {
        const column = i < rows ? 0 : 1,
          row = i < rows ? i : i - rows;
        const x = 49 + column * 266,
          top = 438 + row * spacing;
        page.drawCircle({ x: x + 2, y: 792 - top - 6, size: 1.8, color: red });
        put(
          feature,
          x + 11,
          top,
          238,
          18,
          10,
          "Equipment item",
          false,
          navy,
          7.5,
        );
      });
      line(306, 439, 306, 547, rule, 0.35);
    } else {
      put(
        "GET TO KNOW YOUR NEXT VEHICLE.",
        50,
        450,
        500,
        24,
        17,
        "Equipment introduction",
        true,
      );
      put(
        "Explore the comfort, technology and safety equipment in person.\nAsk our team for a walkaround and a test drive.",
        50,
        487,
        495,
        44,
        11,
        "Equipment fallback",
        false,
        muted,
      );
    }
    put(
      options.highlights
        ? "VEHICLE HIGHLIGHTS"
        : "YOUR NEXT DRIVE STARTS HERE.",
      43,
      573,
      526,
      14,
      9,
      "Highlights heading",
      true,
      red,
    );
    put(
      options.highlights ||
        "See it. Drive it. Make it yours. Ask our team about this vehicle and available protection options.",
      43,
      591,
      526,
      40,
      10,
      "Vehicle highlights",
      false,
      navy,
      8,
    );

    rectangle(36, 641, 540, 76, pale, navy, 1);
    rectangle(36, 641, 5, 76, red, red, 0);
    put(
      "PRICE BREAKDOWN",
      50,
      652,
      225,
      12,
      8,
      "Price breakdown heading",
      true,
      muted,
    );
    put(
      `Vehicle price ${currency(options.price)}\nDealer administration fee ${currency(options.administrationFee)}`,
      50,
      671,
      235,
      30,
      9,
      "Price itemization",
      false,
      navy,
      8,
    );
    put("TOTAL ASKING PRICE", 305, 650, 257, 13, 9, "Price label", true, muted);
    put(
      currency(stickerTotal(options.price, options.administrationFee)),
      302,
      669,
      260,
      42,
      37,
      "Total asking price",
      true,
      red,
      26,
    );
    put(options.website, 43, 728, 303, 15, 11, "Dealer website", true, navy, 8);
    put(options.phone, 378, 728, 193, 15, 11, "Dealer phone", true, navy, 8);
    put(
      "Excludes tax, title and registration. Optional products cost extra. See Buyers Guide for warranty terms.",
      43,
      746,
      526,
      10,
      7,
      "Price disclosure",
      false,
      muted,
    );
    const sources = [
      specs.vinDecoded
        ? "VIN specs: NHTSA + dealer entries."
        : "Specs: dealer-provided.",
      hasEconomy
        ? specs.epaId
          ? `EPA rating: FuelEconomy.gov #${specs.epaId}.`
          : "Economy: dealer-provided."
        : "",
      "Verify equipment. Dealer window sticker.",
    ]
      .filter(Boolean)
      .join(" ");
    put(sources, 43, 756, 526, 9, 6, "Specifications source", false, muted);
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
