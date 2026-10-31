import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function protectionPdfAssets() {
  const [logo, regular, bold] = await Promise.all([
    readFile(join(process.cwd(), "public/print-materials/drive-max-logo.png")),
    readFile(
      join(
        process.cwd(),
        "public/pdf-standard-fonts/LiberationSans-Regular.ttf",
      ),
    ),
    readFile(
      join(process.cwd(), "public/pdf-standard-fonts/LiberationSans-Bold.ttf"),
    ),
  ]);
  return { logo, fonts: { regular, bold } };
}
