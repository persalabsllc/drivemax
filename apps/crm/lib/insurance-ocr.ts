import { parseInsuranceText } from "./insurance-scan";
import type { Worker } from "tesseract.js";
export async function readInsuranceCard(
  file: File,
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  if (signal.aborted) throw new DOMException("Canceled", "AbortError");
  const { createWorker, PSM } = await import("tesseract.js");
  if (signal.aborted) throw new DOMException("Canceled", "AbortError");
  let worker: Worker | undefined,
    timedOut = false;
  let rejectStopped: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStopped = reject;
  });
  const cancel = () => {
    void worker?.terminate();
    rejectStopped(new DOMException("Canceled", "AbortError"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    void worker?.terminate();
    rejectStopped(
      Error(
        "The scan took too long. Try a closer, well-lit photo or enter the details below.",
      ),
    );
  }, 90000);
  const root = new URL("/ocr/v6/", window.location.origin).href;
  const creating = createWorker("eng", 1, {
    workerPath: root + "worker.min.js",
    corePath: root,
    langPath: root.slice(0, -1),
    workerBlobURL: false,
    cacheMethod: "none",
    logger: (m) => {
      if (!signal.aborted && !timedOut)
        onProgress(
          m.status === "recognizing text" ? Math.round(m.progress * 100) : 0,
        );
    },
  });
  creating
    .then((w) => {
      if (signal.aborted || timedOut) void w.terminate();
    })
    .catch(() => {});
  try {
    worker = await Promise.race([creating, stopped]);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await Promise.race([
      worker.recognize(file, {}, { text: true }),
      stopped,
    ]);
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    return parseInsuranceText(result.data.text);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await worker?.terminate();
  }
}
