"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Expand, X } from "lucide-react";
import type { GalleryPhoto } from "../../lib/customer-gallery";

export default function CustomerGallery({
  photos,
  layout = "strip",
}: {
  photos: GalleryPhoto[];
  layout?: "strip" | "grid" | "collage";
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [visible, setVisible] = useState(12);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const active = index === null ? null : photos[index];
  useEffect(() => {
    if (index === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [index]);
  function close() {
    dialog.current?.close();
    setIndex(null);
    trigger.current?.focus();
  }
  function step(n: number) {
    setIndex((current) =>
      current === null ? null : (current + n + photos.length) % photos.length,
    );
  }
  if (!photos.length) return null;
  const shown = layout === "grid" ? photos.slice(0, visible) : photos;
  return (
    <>
      <div className={`customer-photos customer-photos-${layout}`}>
        {shown.map((photo, i) => (
          <figure
            className="customer-photo"
            data-kind={photo.kind}
            key={photo.id}
          >
            <button
              type="button"
              className="customer-photo-open"
              aria-label={`Enlarge photo: ${photo.alt}`}
              onClick={(e) => {
                trigger.current = e.currentTarget;
                setIndex(i);
              }}
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                width={photo.kind === "exterior" ? 1280 : 720}
                height={720}
                unoptimized={photo.src.startsWith("/api/")}
                sizes={
                  photo.kind !== "customer"
                    ? "(max-width: 980px) calc(100vw - 30px), 640px"
                    : layout === "collage"
                      ? "(max-width: 760px) 80vw, 560px"
                      : "(max-width: 600px) 80vw, (max-width: 980px) 45vw, 290px"
                }
              />
              <span className="customer-photo-expand">
                <Expand size={16} aria-hidden="true" />
              </span>
            </button>
            {(photo.caption || photo.taken_year) && (
              <figcaption>
                <span>{photo.caption || "A Drive Max memory"}</span>
                {photo.taken_year && <small>{photo.taken_year}</small>}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {layout === "strip" && photos.length > 1 && (
        <p className="customer-swipe">
          Swipe to explore <ArrowRight size={14} aria-hidden="true" />
        </p>
      )}
      {layout === "grid" && visible < photos.length && (
        <button
          type="button"
          className="button button-secondary customer-show-more"
          onClick={() => setVisible((v) => v + 12)}
        >
          See more memories <ArrowRight size={17} aria-hidden="true" />
        </button>
      )}
      <dialog
        ref={dialog}
        className="customer-lightbox"
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          }
        }}
      >
        {active && (
          <div className="customer-lightbox-inner">
            <div className="customer-lightbox-top">
              <span id={titleId}>
                {active.kind === "customer"
                  ? "The Drive Max family"
                  : "A look around Drive Max"}{" "}
                <small>
                  {" "}
                  {index! + 1} / {photos.length}
                </small>
              </span>
              <button
                type="button"
                autoFocus
                aria-label="Close photo"
                onClick={close}
              >
                <X />
              </button>
            </div>
            <Image
              className="customer-lightbox-image"
              src={active.src}
              alt={active.alt}
              width={1800}
              height={1800}
              unoptimized
              sizes="90vw"
            />
            <div className="customer-lightbox-bottom">
              <button
                type="button"
                aria-label="Previous customer photo"
                onClick={() => step(-1)}
                disabled={photos.length < 2}
              >
                <ArrowLeft />
              </button>
              <p aria-live="polite">
                {active.caption}
                {active.taken_year ? ` · ${active.taken_year}` : ""}
              </p>
              <button
                type="button"
                aria-label="Next customer photo"
                onClick={() => step(1)}
                disabled={photos.length < 2}
              >
                <ArrowRight />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
