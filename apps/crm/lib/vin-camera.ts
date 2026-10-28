import { vinFromBarcode, vinReadTracker } from "./vin-scan";

export type BarcodeDecoder = (
  canvas: HTMLCanvasElement,
  rotate?: boolean,
) => string | null;
export type VinCameraControls = {
  stop: () => void;
  setTorch?: (on: boolean) => Promise<void>;
};

// Loaded only after Scan VIN / a photo is selected. This also works in browsers
// without the native BarcodeDetector API, including Safari.
export async function createBarcodeDecoder(): Promise<BarcodeDecoder> {
  const zxing = await import("@zxing/library");
  const hints = new Map();
  hints.set(zxing.DecodeHintType.TRY_HARDER, true);
  // Try door-label formats first. Individual readers avoid the aggregate reader's
  // warning log on every ordinary no-barcode frame and support optional Code 39 checksums.
  const readers = [
    new zxing.Code39Reader(),
    new zxing.Code128Reader(),
    new zxing.Code39Reader(true),
    new zxing.DataMatrixReader(),
    new zxing.QRCodeReader(),
    new zxing.PDF417Reader(),
  ];
  function read(pixels: Uint8ClampedArray, width: number, height: number) {
    const bitmap = new zxing.BinaryBitmap(
      new zxing.HybridBinarizer(
        new zxing.RGBLuminanceSource(pixels, width, height),
      ),
    );
    let other: string | null = null;
    for (const reader of readers) {
      try {
        const text = reader.decode(bitmap, hints).getText();
        if (vinFromBarcode(text)) return text;
        other ??= text;
      } catch (error) {
        if (
          !(
            error instanceof zxing.NotFoundException ||
            error instanceof zxing.ChecksumException ||
            error instanceof zxing.FormatException
          )
        )
          throw error;
      } finally {
        reader.reset();
      }
    }
    return other;
  }
  return (canvas, rotate = false) => {
    const { width, height } = canvas,
      context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    const rgba = context.getImageData(0, 0, width, height).data,
      gray = new Uint8ClampedArray(width * height);
    for (let n = 0; n < gray.length; n++) {
      const p = n * 4;
      gray[n] =
        rgba[p + 3] === 0
          ? 255
          : Math.round(
              0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2],
            );
    }
    const result = read(gray, width, height);
    if ((result !== null && vinFromBarcode(result)) || !rotate) return result;
    const turned = new Uint8ClampedArray(gray.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        turned[x * height + height - y - 1] = gray[y * width + x];
    return read(turned, height, width) ?? result;
  };
}

export async function startVinCamera({
  video,
  signal,
  onVin,
  onHint,
  onError,
  decoder = createBarcodeDecoder,
}: {
  video: HTMLVideoElement;
  signal: AbortSignal;
  onVin: (vin: string) => void;
  onHint: (message: string) => void;
  onError: (error: unknown) => void;
  decoder?: () => Promise<BarcodeDecoder>;
}): Promise<VinCameraControls> {
  let stream: MediaStream | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false;
  const ended = () => {
    if (!stopped) {
      stop();
      onError(new Error("Camera ended"));
    }
  };
  function stop() {
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener("ended", ended);
      track.stop();
    }
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  }
  if (signal.aborted) return { stop };
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Camera API unavailable");
  // Handle a decoder failure even if the user leaves the permission prompt open.
  const pendingDecoder = decoder().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  signal.addEventListener("abort", stop, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    // Permission can resolve after the scanner was closed or replaced.
    if (signal.aborted || stopped) {
      stop();
      return { stop };
    }
    for (const track of stream.getTracks())
      track.addEventListener("ended", ended);
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const loaded = await pendingDecoder;
    if (signal.aborted || stopped) {
      stop();
      return { stop };
    }
    if ("error" in loaded) throw loaded.error;
    const decode = loaded.value;
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    const remember = vinReadTracker();
    let frame = 0;
    function scan() {
      if (stopped || signal.aborted) return;
      try {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const width = video.videoWidth,
            height = video.videoHeight;
          // Favor the center band on a door label; periodically try the full frame.
          const crop = ++frame % 3 === 0 ? height : height * 0.55;
          const scale = Math.min(1, 1920 / width);
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(crop * scale);
          context!.drawImage(
            video,
            0,
            (height - crop) / 2,
            width,
            crop,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const raw = decode(canvas, frame % 3 === 0),
            vin = raw === null ? null : vinFromBarcode(raw);
          if (raw !== null)
            onHint(
              vin
                ? "VIN detected. Hold steady for a second read…"
                : "That barcode is not a complete VIN. Aim at the barcode beside the printed VIN.",
            );
          const confirmed = remember(vin);
          if (confirmed) {
            stop();
            onVin(confirmed);
            return;
          }
        }
        timer = setTimeout(scan, 220);
      } catch (error) {
        stop();
        onError(error);
      }
    }
    timer = setTimeout(scan, 0);
    const track = stream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    return {
      stop,
      ...(capabilities?.torch
        ? {
            setTorch: async (on: boolean) => {
              if (stopped || signal.aborted) return;
              await track.applyConstraints({
                advanced: [{ torch: on } as MediaTrackConstraintSet],
              });
            },
          }
        : {}),
    };
  } catch (error) {
    stop();
    throw error;
  }
}

/** Decode locally. Photo bytes and object URLs never leave this browser. */
export async function readVinPhoto(
  file: File,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) return null;
  if (!file.type.startsWith("image/"))
    throw new Error("Choose a photo of the VIN barcode.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "Use a photo smaller than 20 MB. A close-up of the VIN barcode works best.",
    );
  const url = URL.createObjectURL(file),
    image = new Image();
  let cancelImage = () => {};
  const abort = () => {
    cancelImage();
    image.src = "";
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pendingImage = new Promise<void>((resolve, reject) => {
      cancelImage = () =>
        reject(new DOMException("Photo canceled", "AbortError"));
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "This photo could not be opened. Try a JPEG or PNG close-up of the barcode.",
          ),
        );
      image.src = url;
    });
    const [decode] = await Promise.all([createBarcodeDecoder(), pendingImage]);
    if (signal.aborted) return null;
    const w = image.naturalWidth,
      h = image.naturalHeight;
    if (!w || !h || w * h > 64000000)
      throw new Error("Use a smaller close-up of the VIN barcode.");
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("Photo scanning is unavailable in this browser.");
    for (const crop of [h * 0.55, h]) {
      if (signal.aborted) return null;
      const scale = Math.min(1, 2400 / Math.max(w, crop));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(crop * scale);
      context.drawImage(
        image,
        0,
        (h - crop) / 2,
        w,
        crop,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const raw = decode(canvas, true),
        vin = raw === null ? null : vinFromBarcode(raw);
      if (vin) return vin;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return null;
  } finally {
    signal.removeEventListener("abort", abort);
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
