import { copyFile, mkdir, readdir } from "node:fs/promises";
// All recognition assets are served by the CRM. Card images stay in the
// browser during recognition and never go to an external OCR provider.
const target = "public/ocr/v6";
await mkdir(target, { recursive: true });
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js",
  `${target}/worker.min.js`,
);
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
  `${target}/worker.min.js.LICENSE.txt`,
);
for (const file of await readdir("node_modules/tesseract.js-core")) {
  if (file.endsWith(".wasm.js") || file.endsWith(".wasm") || file === "LICENSE")
    await copyFile(
      `node_modules/tesseract.js-core/${file}`,
      `${target}/${file}`,
    );
}
await copyFile(
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  `${target}/eng.traineddata.gz`,
);
