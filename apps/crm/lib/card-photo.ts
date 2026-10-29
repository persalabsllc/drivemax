import { MAX_LICENSE_BYTES } from "./license-scan";
/** Normalize orientation and remove photo metadata before private storage. */
export async function prepareCardPhoto(
  file: File,
  signal: AbortSignal,
  rotation = 0,
  label = "license",
) {
  if (
    !file.type.startsWith("image/") ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw Error(`Choose a photo of the ${label} smaller than 20 MB.`);
  const url = URL.createObjectURL(file),
    img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 64000000)
      throw Error(`Choose a smaller ${label} photo.`);
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
      throw Error(`Use a closer photo of just the ${label}.`);
    return {
      file: new File([blob], `${label.replaceAll(" ", "-")}.jpg`, {
        type: "image/jpeg",
      }),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (e) {
    if (signal.aborted) throw e;
    throw Error(
      e instanceof Error && e.message.includes("photo")
        ? e.message
        : `This image could not be opened. Try a JPG or PNG photo of the ${label}.`,
    );
  } finally {
    URL.revokeObjectURL(url);
    img.src = "";
  }
}
