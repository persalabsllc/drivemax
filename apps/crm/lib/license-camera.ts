import {
  createBarcodeDecoder,
  type BarcodeDecoder,
  type VinCameraControls as LicenseCameraControls,
} from "./vin-camera";
import { vinReadTracker } from "./vin-scan";
import {
  parseLicenseBarcode,
  MAX_LICENSE_BYTES,
  type LicenseDetails,
} from "./license-scan";
export type { LicenseCameraControls };
/** Normalize orientation and remove photo metadata before private storage. */
export async function prepareLicensePhoto(
  file: File,
  signal: AbortSignal,
  rotation = 0,
) {
  if (
    !file.type.startsWith("image/") ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw Error("Choose a license photo smaller than 20 MB.");
  const url = URL.createObjectURL(file),
    img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 64000000)
      throw Error("Choose a smaller license photo.");
    const turn = rotation % 180 !== 0;
    const scale = Math.min(
      1,
      2000 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.round(img.naturalWidth * scale),
      h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = turn ? h : w;
    canvas.height = turn ? w : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Photo capture is unavailable in this browser.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("Photo could not be prepared."))),
        "image/jpeg",
        0.92,
      ),
    );
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (blob.size > MAX_LICENSE_BYTES)
      throw Error("Use a closer photo of just the license.");
    return {
      file: new File([blob], "Driver-license.jpg", { type: "image/jpeg" }),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (e) {
    if (signal.aborted) throw e;
    throw Error(
      e instanceof Error && e.message.includes("photo")
        ? e.message
        : "This image could not be opened. Try a JPG or PNG photo of the license.",
    );
  } finally {
    URL.revokeObjectURL(url);
    img.src = "";
  }
}
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
      (MediaTrackCapabilities & { torch?: boolean }) | undefined;
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
