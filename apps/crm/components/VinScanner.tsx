"use client";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  CheckCircle2,
  Flashlight,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import {
  readVinPhoto,
  startVinCamera,
  type VinCameraControls,
} from "../lib/vin-camera";
import { cameraErrorMessage } from "../lib/vin-scan";

export function VinScanner({
  onScan,
  onClose,
}: {
  onScan: (vin: string) => void;
  onClose: () => void;
}) {
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null),
    photo = useRef<AbortController | null>(null),
    controls = useRef<VinCameraControls | null>(null);
  const [attempt, setAttempt] = useState(0),
    [stage, setStage] = useState<
      "opening" | "scanning" | "found" | "paused" | "error" | "photo"
    >("opening");
  const [vin, setVin] = useState(""),
    [message, setMessage] = useState(""),
    [hint, setHint] = useState("");
  const [hasTorch, setHasTorch] = useState(false),
    [torch, setTorch] = useState(false),
    [torchBusy, setTorchBusy] = useState(false);

  function close() {
    active.current?.abort();
    photo.current?.abort();
    onClose();
  }
  function restart() {
    photo.current?.abort();
    setVin("");
    setAttempt((n) => n + 1);
  }
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    controls.current = null;
    setStage("opening");
    setMessage("");
    setHint("");
    setHasTorch(false);
    setTorch(false);
    setTorchBusy(false);
    if (video.current)
      void startVinCamera({
        video: video.current,
        signal: controller.signal,
        onVin: (value) => {
          if (!controller.signal.aborted) {
            controller.abort();
            setVin(value);
            setStage("found");
            setTorch(false);
            setMessage("");
          }
        },
        onHint: (value) => {
          if (!controller.signal.aborted) setHint(value);
        },
        onError: (error) => {
          if (!controller.signal.aborted) {
            controller.abort();
            setStage("error");
            setMessage(cameraErrorMessage(error));
          }
        },
      })
        .then((value) => {
          if (controller.signal.aborted) {
            value.stop();
            return;
          }
          controls.current = value;
          setHasTorch(!!value.setTorch);
          setStage("scanning");
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setStage("error");
            setMessage(cameraErrorMessage(error));
          }
        });
    // Stop the hardware when switching apps or locking the phone. Resumption is explicit.
    const pause = () => {
      controller.abort();
      setStage((current) =>
        current === "opening" || current === "scanning" ? "paused" : current,
      );
      setTorch(false);
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
  }, [attempt]);
  useEffect(
    () => () => {
      photo.current?.abort();
    },
    [],
  );

  async function scanPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    active.current?.abort();
    photo.current?.abort();
    const controller = new AbortController();
    photo.current = controller;
    setStage("photo");
    setMessage("");
    setTorch(false);
    setVin("");
    try {
      const value = await readVinPhoto(selected, controller.signal);
      if (controller.signal.aborted) return;
      if (value) {
        setVin(value);
        setStage("found");
      } else {
        setStage("paused");
        setMessage(
          "No complete VIN barcode was found. Take a closer, sharper photo with the whole barcode visible, or enter the VIN manually.",
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStage("paused");
        setMessage(
          error instanceof Error
            ? error.message
            : "The photo could not be scanned. Try another photo or enter the VIN.",
        );
      }
    }
  }
  async function toggleTorch() {
    const session = controls.current,
      controller = active.current,
      wanted = !torch;
    if (!session?.setTorch || torchBusy) return;
    setTorchBusy(true);
    try {
      await session.setTorch(wanted);
      if (active.current === controller && !controller?.signal.aborted)
        setTorch(wanted);
    } catch {
      if (active.current === controller && !controller?.signal.aborted)
        setMessage(
          "The camera light is unavailable. Try better lighting or scan a photo.",
        );
    } finally {
      if (active.current === controller) setTorchBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="modal vin-scanner"
      aria-labelledby={id}
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
          <h2 id={id}>Scan VIN</h2>
          <p>Use the VIN barcode on the door-jamb label.</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close VIN scanner"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="vin-scanner-body">
        <div className="vin-camera-view" hidden={stage === "found"}>
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="VIN camera preview"
          />
          {stage === "scanning" ? (
            <div className="vin-camera-guide" aria-hidden="true" />
          ) : (
            <div className="vin-camera-overlay">
              {stage === "opening" || stage === "photo" ? (
                <LoaderCircle className="spin" size={28} />
              ) : (
                <Camera size={32} />
              )}
              <span>
                {stage === "opening"
                  ? "Opening rear camera…"
                  : stage === "photo"
                    ? "Reading photo…"
                    : "Camera paused"}
              </span>
            </div>
          )}
        </div>
        {stage === "found" ? (
          <div className="vin-scan-result">
            <CheckCircle2 size={28} />
            <h3>Check the VIN</h3>
            <code aria-label="Scanned VIN">{vin}</code>
            <p>
              Compare all 17 characters with the printed VIN before using it.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onScan(vin);
                close();
              }}
            >
              <CheckCircle2 size={17} /> Use this VIN
            </button>
            <button type="button" className="text-btn" onClick={restart}>
              <RotateCcw size={15} /> Scan again
            </button>
          </div>
        ) : (
          <>
            <p className="vin-scan-status" role="status">
              {stage === "opening"
                ? "Allow camera access if your phone asks. Your microphone is not needed."
                : stage === "scanning"
                  ? hint ||
                    "Keep the whole barcode in view. Hold steady and move closer until the bars are sharp."
                  : stage === "photo"
                    ? "Reading the barcode on this device…"
                    : "Resume the camera, try a photo, or enter the VIN."}
            </p>
            {message && (
              <p className="vin-scan-error" role="alert">
                {message}
              </p>
            )}
            <div className="vin-scan-actions">
              {(stage === "paused" || stage === "error") && (
                <button type="button" className="btn primary" onClick={restart}>
                  <Camera size={17} /> Try camera again
                </button>
              )}
              {stage === "scanning" && hasTorch && (
                <button
                  type="button"
                  className="btn"
                  aria-pressed={torch}
                  disabled={torchBusy}
                  onClick={() => void toggleTorch()}
                >
                  <Flashlight size={17} /> {torch ? "Light off" : "Light on"}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={stage === "photo"}
                onClick={() => {
                  active.current?.abort();
                  setStage("paused");
                  setTorch(false);
                  file.current?.click();
                }}
              >
                <ImagePlus size={17} /> Scan a photo
              </button>
            </div>
            <p className="vin-scan-tip">
              Aim at the barcode beside the VIN, rather than the tire or parts
              label. Avoid glare; a little distance often helps the camera
              focus.
            </p>
          </>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="VIN barcode photo"
          hidden
          onChange={scanPhoto}
        />
        <footer className="vin-scan-footer">
          <span>Camera images stay on your device.</span>
          <button type="button" className="text-btn" onClick={close}>
            Enter VIN manually
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
