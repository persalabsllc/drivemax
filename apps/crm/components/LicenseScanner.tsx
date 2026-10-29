"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ImagePlus, RotateCcw, X } from "lucide-react";
import {
  startLicenseCamera,
  readLicenseBarcodePhoto,
  prepareLicensePhoto,
} from "../lib/license-camera";
import { cameraErrorMessage } from "../lib/vin-scan";
import {
  type LicenseCapture,
  type LicenseCrop,
  type LicenseDetails,
} from "../lib/license-scan";
import { fullName } from "../lib/people";

export function LicensePortrait({
  src,
  crop,
  alt = "Customer profile photo",
}: {
  src: string;
  crop: LicenseCrop;
  alt?: string;
}) {
  return (
    <span className="license-portrait">
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${(-100 * crop.x) / crop.width}%`,
          top: `${(-100 * crop.y) / crop.height}%`,
        }}
      />
    </span>
  );
}
export function LicenseScanner({
  onScan,
  onClose,
}: {
  onScan: (details: LicenseDetails | null, capture: LicenseCapture) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [step, setStep] = useState<"barcode" | "photo">("barcode"),
    [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState("opening"),
    [error, setError] = useState(""),
    [hint, setHint] = useState("");
  const [details, setDetails] = useState<LicenseDetails | null>(null);
  const [photo, setPhoto] = useState<{
      file: File;
      width: number;
      height: number;
    } | null>(null),
    [url, setUrl] = useState("");
  const [crop, setCrop] = useState<LicenseCrop>({
    x: 0.06,
    y: 0.25,
    width: 0.22,
    height: 0.35,
  });
  const [confirmed, setConfirmed] = useState(false);
  const backInput = useRef<HTMLInputElement>(null),
    frontCamera = useRef<HTMLInputElement>(null),
    frontUpload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => {
      el?.close();
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!photo) {
      setUrl("");
      return;
    }
    const src = URL.createObjectURL(photo.file);
    setUrl(src);
    return () => URL.revokeObjectURL(src);
  }, [photo]);
  useEffect(() => {
    if (step !== "barcode") return;
    const controller = new AbortController();
    operation.current = controller;
    setStage("opening");
    setError("");
    setHint("");
    if (video.current)
      void startLicenseCamera({
        video: video.current,
        signal: controller.signal,
        onLicense: (value) => {
          if (controller.signal.aborted) return;
          controller.abort();
          setDetails(value);
          setStep("photo");
          setStage("ready");
        },
        onHint: (value) => {
          if (!controller.signal.aborted) setHint(value);
        },
        onError: (err) => {
          if (!controller.signal.aborted) {
            controller.abort();
            setStage("paused");
            setError(
              cameraErrorMessage(err).replace(/VIN/g, "license details"),
            );
          }
        },
      })
        .then((controls) => {
          if (controller.signal.aborted) controls.stop();
          else setStage("scanning");
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            setStage("paused");
            setError(
              cameraErrorMessage(err).replace(/VIN/g, "license details"),
            );
          }
        });
    const pause = () => {
      controller.abort();
      setStage("paused");
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
    };
  }, [step, attempt]);
  function close() {
    operation.current?.abort();
    onClose();
  }
  function task() {
    operation.current?.abort();
    const c = new AbortController();
    operation.current = c;
    setError("");
    setStage("working");
    return c;
  }
  async function readBack(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const c = task();
    try {
      const found = await readLicenseBarcodePhoto(file, c.signal);
      if (c.signal.aborted) return;
      if (!found)
        throw Error(
          "No readable license barcode was found. Try a sharper close-up of the entire barcode, or enter the details manually.",
        );
      setDetails(found);
      setStep("photo");
      setStage("ready");
    } catch (err) {
      if (!c.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Photo could not be scanned.",
        );
        setStage("paused");
      }
    }
  }
  async function front(file: File, rotation = 0) {
    const c = task();
    try {
      const prepared = await prepareLicensePhoto(file, c.signal, rotation);
      if (c.signal.aborted) return;
      setPhoto(prepared);
      const width = Math.min(0.24, (0.6 * prepared.height) / prepared.width);
      setCrop({
        x: 0.06,
        y: 0.2,
        width,
        height: (width * prepared.width) / prepared.height,
      });
      setConfirmed(false);
      setStage("ready");
    } catch (err) {
      if (!c.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Photo could not be opened.",
        );
        setStage("ready");
      }
    }
  }
  function readFront(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void front(file);
  }
  function place(e: PointerEvent<HTMLDivElement>) {
    if (
      !photo ||
      (e.type === "pointermove" &&
        !e.currentTarget.hasPointerCapture(e.pointerId))
    )
      return;
    if (e.type === "pointerdown")
      e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    setCrop((c) => ({
      ...c,
      x: Math.max(
        0,
        Math.min(1 - c.width, (e.clientX - r.left) / r.width - c.width / 2),
      ),
      y: Math.max(
        0,
        Math.min(1 - c.height, (e.clientY - r.top) / r.height - c.height / 2),
      ),
    }));
  }
  const working = stage === "working";
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="modal license-scanner"
      aria-label="Scan driver license"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) close();
      }}
    >
      <header className="modal-head">
        <div>
          <h2>Scan driver license</h2>
          <p>
            {step === "barcode"
              ? "1. Scan the barcode on the back"
              : "2. Capture the front and choose the profile photo"}
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close license scanner"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="license-scanner-body">
        {step === "barcode" ? (
          <>
            <div className="license-camera">
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                aria-label="License barcode camera"
              />
              <span>Center the entire rectangular barcode</span>
            </div>
            <p className="fine-print" role="status">
              {working
                ? "Reading barcode…"
                : stage === "opening"
                  ? "Opening camera…"
                  : hint ||
                    "Hold steady in good light. Avoid glare on the barcode."}
            </p>
            <div className="license-actions">
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => setAttempt((n) => n + 1)}
              >
                <Camera size={16} />
                {stage === "paused" ? "Resume camera" : "Restart camera"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => backInput.current?.click()}
              >
                <ImagePlus size={16} />
                Scan a barcode photo
              </button>
            </div>
            <input
              ref={backInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Upload license barcode photo"
              onChange={readBack}
            />
            <button
              type="button"
              className="text-btn"
              disabled={working}
              onClick={() => {
                operation.current?.abort();
                setDetails(null);
                setStep("photo");
                setStage("ready");
                setError("");
              }}
            >
              Enter details manually & capture photo
            </button>
          </>
        ) : (
          <>
            {details && (
              <div className="license-found">
                <Check size={18} />
                <div>
                  <strong>{fullName(details.person)}</strong>
                  <span>
                    Details read. Review them in the customer form before
                    saving.
                  </span>
                  {details.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              </div>
            )}
            <p className="fine-print">
              Photograph the entire front of the license, straight on, so all
              text is readable. This copy can be included with the sold pack.
            </p>
            <div className="license-actions">
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => frontCamera.current?.click()}
              >
                <Camera size={16} />
                {photo ? "Retake front photo" : "Take front photo"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => frontUpload.current?.click()}
              >
                <ImagePlus size={16} />
                Upload front photo
              </button>
            </div>
            <input
              ref={frontCamera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label="Take license front photo"
              onChange={readFront}
            />
            <input
              ref={frontUpload}
              type="file"
              accept="image/*"
              hidden
              aria-label="Upload license front photo"
              onChange={readFront}
            />
            {working && <p role="status">Preparing photo…</p>}
            {photo && url && (
              <>
                <div
                  className="license-crop-image"
                  onPointerDown={place}
                  onPointerMove={place}
                >
                  <img
                    src={url}
                    alt="Full front of license; move the box onto the customer's face"
                    draggable={false}
                  />
                  <span
                    className="license-crop-box"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                </div>
                <div className="license-crop-controls">
                  <LicensePortrait src={url} crop={crop} />
                  <div>
                    <strong>Profile photo</strong>
                    <p>
                      Tap or drag the box onto the customer's face. The full
                      license stays saved.
                    </p>
                  </div>
                  <button
                    className="btn small"
                    type="button"
                    disabled={working}
                    onClick={() => void front(photo.file, 90)}
                  >
                    <RotateCcw size={14} />
                    Rotate
                  </button>
                </div>
                <div className="license-crop-sliders">
                  <label>
                    Photo size
                    <input
                      aria-label="Profile photo size"
                      type="range"
                      min=".05"
                      max={Math.min(0.65, (0.85 * photo.height) / photo.width)}
                      step=".01"
                      value={crop.width}
                      onChange={(e) => {
                        const w = Number(e.target.value),
                          h = (w * photo.width) / photo.height;
                        setCrop((c) => ({
                          width: w,
                          height: h,
                          x: Math.min(c.x, 1 - w),
                          y: Math.min(c.y, 1 - h),
                        }));
                      }}
                    />
                  </label>
                  <label>
                    Horizontal position
                    <input
                      type="range"
                      min="0"
                      max={1 - crop.width}
                      step=".005"
                      value={crop.x}
                      onChange={(e) =>
                        setCrop({ ...crop, x: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Vertical position
                    <input
                      type="range"
                      min="0"
                      max={1 - crop.height}
                      step=".005"
                      value={crop.y}
                      onChange={(e) =>
                        setCrop({ ...crop, y: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  The license is readable and the profile photo is framed
                  correctly.
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={working || !confirmed}
                  onClick={() =>
                    onScan(details, {
                      id: crypto.randomUUID(),
                      file: photo.file,
                      crop,
                    })
                  }
                >
                  <Check size={16} />
                  Use license & review customer
                </button>
              </>
            )}
            <button
              type="button"
              className="text-btn"
              disabled={working}
              onClick={() => {
                setStep("barcode");
                setDetails(null);
              }}
            >
              Scan a different license
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
