import {
  createBarcodeDecoder,
  type BarcodeDecoder,
  type VinCameraControls as LicenseCameraControls,
} from "./vin-camera";
import { vinReadTracker } from "./vin-scan";
import { parseLicenseBarcode, type LicenseDetails } from "./license-scan";
export type { LicenseCameraControls };
export { prepareCardPhoto as prepareLicensePhoto } from "./card-photo";
export async function startLicenseCamera({
  video,
  signal,
  onLicense,
  onHint,
  onError,
  decoder = () => createBarcodeDecoder("pdf417"),
}: {
  video: HTMLVideoElement;
  signal: AbortSignal;
  onLicense: (details: LicenseDetails) => void;
  onHint: (message: string) => void;
  onError: (error: unknown) => void;
  decoder?: () => Promise<BarcodeDecoder>;
}): Promise<LicenseCameraControls> {
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
          // Try the center band, then the full frame for a dense license barcode.
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
            vin = raw === null ? null : parseLicenseBarcode(raw) ? raw : null;
          if (raw !== null)
            onHint(
              vin
                ? "License detected. Hold steady for a second read…"
                : "Aim at the large rectangular barcode on the back of the license.",
            );
          const confirmed = remember(vin);
          if (confirmed) {
            stop();
            onLicense(parseLicenseBarcode(confirmed)!);
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

/** Decode locally. Barcode decoding stays on this device; the raw barcode is not uploaded. */
export async function readLicenseBarcodePhoto(
  file: File,
  signal: AbortSignal,
): Promise<LicenseDetails | null> {
  if (signal.aborted) return null;
  if (!file.type.startsWith("image/"))
    throw new Error("Choose a photo of the license barcode.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "Use a photo smaller than 20 MB. A close-up of the license barcode works best.",
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
    const [decode] = await Promise.all([
      createBarcodeDecoder("pdf417"),
      pendingImage,
    ]);
    if (signal.aborted) return null;
    const w = image.naturalWidth,
      h = image.naturalHeight;
    if (!w || !h || w * h > 64000000)
      throw new Error("Use a smaller close-up of the license barcode.");
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
        vin = raw === null ? null : parseLicenseBarcode(raw) ? raw : null;
      if (vin) return parseLicenseBarcode(vin);
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
