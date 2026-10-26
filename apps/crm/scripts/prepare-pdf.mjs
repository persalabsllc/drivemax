import { copyFile, mkdir, cp } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf.worker.min.mjs",
);
await cp(
  "node_modules/pdfjs-dist/standard_fonts",
  "public/pdf-standard-fonts",
  { recursive: true },
);
