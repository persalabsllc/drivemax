"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, ImagePlus, RefreshCw, Star } from "lucide-react";
import { Modal } from "./ui";
import {
  galleryFields,
  galleryKindLabel,
  type GalleryFields,
  type GalleryPhoto,
} from "../lib/customer-gallery";

const defaults: GalleryFields = {
  caption: "",
  alt: "",
  kind: "customer",
  featured: false,
  published: false,
  sort_order: 100,
  taken_year: null,
};
const demoPhotos: GalleryPhoto[] = [
  {
    ...defaults,
    id: "demo-photo-1",
    preview: "/customers/honda-delivery.webp",
    caption: "A new set of keys",
    alt: "Customer beside her Honda minivan",
    published: true,
    featured: true,
    taken_year: 2020,
    sort_order: 10,
    updated_at: "demo",
  },
  {
    ...defaults,
    id: "demo-photo-2",
    preview: "/customers/escape-delivery.webp",
    caption: "Ready for the road",
    alt: "Customer with his Ford Escape",
    published: true,
    featured: true,
    taken_year: 2019,
    sort_order: 20,
    updated_at: "demo",
  },
];

async function uploadFile(file: File) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a photo under 20 MB.");
  if (file.size < 3.8 * 1024 * 1024) return file;
  const image = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the photo.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob || blob.size > 4 * 1024 * 1024)
      throw new Error("Choose a smaller JPG, PNG or WebP.");
    return new File([blob], "delivery.webp", { type: blob.type });
  } finally {
    image.close();
  }
}

export function CustomerGallery({ demo }: { demo: boolean }) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>(demo ? demoPhotos : []);
  const [loading, setLoading] = useState(!demo),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [editor, setEditor] = useState<GalleryPhoto | "new" | null>(null);
  const [filter, setFilter] = useState("all");
  const demoUrls = useRef<string[]>([]);
  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/customer-gallery", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load photos.");
      setPhotos(data.photos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load photos.");
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void load();
    return () => {
      demoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [load]);
  const visible = photos.filter(
    (p) =>
      filter === "all" ||
      (filter === "hidden" ? !p.published : p.kind === filter),
  );
  return (
    <section className="gallery-workspace">
      <div className="panel gallery-intro">
        <div>
          <span className="gallery-eyebrow">
            <Camera size={16} /> Your website, in pictures
          </span>
          <h2>The Drive Max family</h2>
          <p>
            Customer delivery memories for the homepage, About and Reviews
            pages. Add finished office photos whenever you’re ready.
          </p>
        </div>
        <div className="gallery-toolbar">
          <a
            className="btn secondary"
            href="https://www.drivemaxusedcars.com/reviews#customer-gallery"
            target="_blank"
            rel="noreferrer"
          >
            View website <ExternalLink size={15} />
          </a>
          <button
            className="btn primary"
            onClick={() => {
              setNotice("");
              setEditor("new");
            }}
          >
            <ImagePlus size={17} /> Add photo
          </button>
        </div>
      </div>
      <div className="gallery-guide">
        <span>
          <Star size={16} /> Homepage: the first four published customer photos
          marked Featured, in display order.
        </span>
        <span>
          Office exterior → homepage & Contact. Exterior and interior → About.
        </span>
        {demo && <strong>Demo changes stay on this page.</strong>}
      </div>
      <div className="gallery-toolbar gallery-filters">
        <label>
          Show{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All photos</option>
            <option value="customer">Customer deliveries</option>
            <option value="exterior">Office exterior</option>
            <option value="interior">Office interior</option>
            <option value="hidden">Hidden / drafts</option>
          </select>
        </label>
        <button
          className="btn secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={16} /> Refresh
        </button>
        <span>
          {photos.filter((p) => p.published).length} published ·{" "}
          {photos.filter((p) => !p.published).length} hidden
        </span>
      </div>
      {error && (
        <p className="gallery-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="gallery-success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Loading photos…</p>
      ) : (
        <div className="gallery-admin-grid">
          {visible.map((photo) => (
            <article className="panel gallery-admin-card" key={photo.id}>
              <img src={photo.preview} alt={photo.alt} loading="lazy" />
              <div className="gallery-admin-card-body">
                <div className="gallery-badges">
                  <span className={photo.published ? "is-published" : ""}>
                    {photo.published ? "Published" : "Hidden"}
                  </span>
                  {photo.featured && (
                    <span>
                      <Star size={12} /> Featured
                    </span>
                  )}
                </div>
                <h3>{photo.caption || galleryKindLabel(photo.kind)}</h3>
                <p>
                  {galleryKindLabel(photo.kind)}
                  {photo.taken_year ? ` · ${photo.taken_year}` : ""} · Order{" "}
                  {photo.sort_order}
                </p>
                <button
                  className="btn secondary"
                  onClick={() => {
                    setNotice("");
                    setEditor(photo);
                  }}
                >
                  Edit photo
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!loading && !visible.length && (
        <div className="panel gallery-empty">
          <Camera size={32} />
          <h3>
            {filter === "exterior" || filter === "interior"
              ? "Ready when your office is."
              : "Room for your next memory."}
          </h3>
          <p>
            {filter === "exterior" || filter === "interior"
              ? "Upload a finished office photo and choose where it belongs. Its section appears on the website when published."
              : "Add a delivery photo or choose a different filter."}
          </p>
        </div>
      )}
      {editor && (
        <PhotoEditor
          photo={editor === "new" ? null : editor}
          nextOrder={Math.max(0, ...photos.map((p) => p.sort_order)) + 10}
          demo={demo}
          onClose={() => setEditor(null)}
          onSaved={async (row, message) => {
            if (demo && row) {
              if (row.preview.startsWith("blob:"))
                demoUrls.current.push(row.preview);
              setPhotos((old) =>
                [...old.filter((p) => p.id !== row.id), row].sort(
                  (a, b) => a.sort_order - b.sort_order,
                ),
              );
            } else await load();
            setEditor(null);
            setNotice(message);
          }}
        />
      )}
    </section>
  );
}

function PhotoEditor({
  photo,
  nextOrder,
  demo,
  onClose,
  onSaved,
}: {
  photo: GalleryPhoto | null;
  nextOrder: number;
  demo: boolean;
  onClose: () => void;
  onSaved: (photo: GalleryPhoto | null, message: string) => Promise<void>;
}) {
  const [fields, setFields] = useState<GalleryFields>(
    photo || { ...defaults, sort_order: nextOrder },
  );
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(photo?.preview || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = galleryFields.safeParse(fields);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (!photo && !file) {
      setError("Choose a photo first.");
      return;
    }
    setBusy(true);
    try {
      if (demo) {
        const demoPreview = file
          ? URL.createObjectURL(await uploadFile(file))
          : preview;
        await onSaved(
          {
            ...parsed.data,
            id: photo?.id || crypto.randomUUID(),
            updated_at: new Date().toISOString(),
            preview: demoPreview,
          },
          "Demo photo saved. The live website is unchanged.",
        );
        return;
      }
      let body: FormData | string;
      if (photo)
        body = JSON.stringify({
          id: photo.id,
          updated_at: photo.updated_at,
          fields: parsed.data,
        });
      else {
        const form = new FormData();
        form.set("file", await uploadFile(file!));
        form.set("fields", JSON.stringify(parsed.data));
        body = form;
      }
      const response = await fetch("/api/customer-gallery", {
        method: photo ? "PATCH" : "POST",
        ...(photo ? { headers: { "Content-Type": "application/json" } } : {}),
        body,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save this photo.");
      await onSaved(null, result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this photo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={photo ? "Edit website photo" : "Add a website photo"}
      subtitle="Choose a photo approved for your public website."
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form className="gallery-editor" onSubmit={save}>
        <div className="gallery-editor-preview">
          {preview ? (
            <img src={preview} alt="Photo preview" />
          ) : (
            <div>
              <Camera size={40} />
              <p>Your photo will appear here</p>
            </div>
          )}
          {!photo && (
            <label className="gallery-file">
              Choose photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <small>
                JPG, PNG or WebP. Large photos are resized automatically.
              </small>
            </label>
          )}
        </div>
        <div className="gallery-editor-fields">
          <label>
            Photo type
            <select
              value={fields.kind}
              disabled={busy}
              onChange={(e) =>
                setFields({
                  ...fields,
                  kind: e.target.value as GalleryFields["kind"],
                  featured: e.target.value === "customer" && fields.featured,
                })
              }
            >
              <option value="customer">Customer delivery</option>
              <option value="exterior">Office exterior</option>
              <option value="interior">Office interior</option>
            </select>
          </label>
          <label>
            Caption <span>(optional)</span>
            <input
              maxLength={160}
              value={fields.caption}
              disabled={busy}
              onChange={(e) =>
                setFields({ ...fields, caption: e.target.value })
              }
              placeholder="A new set of keys"
            />
          </label>
          <label>
            Photo description
            <input
              required
              minLength={3}
              maxLength={240}
              value={fields.alt}
              disabled={busy}
              onChange={(e) => setFields({ ...fields, alt: e.target.value })}
              placeholder="Customer beside their new SUV"
            />
            <small>
              Describe the picture for visitors using a screen reader.
            </small>
          </label>
          <div className="gallery-editor-two">
            <label>
              Year <span>(optional)</span>
              <input
                type="number"
                min={2019}
                max={2100}
                value={fields.taken_year ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    taken_year: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              Display order
              <input
                type="number"
                min={0}
                max={99999}
                required
                value={fields.sort_order}
                disabled={busy}
                onChange={(e) =>
                  setFields({ ...fields, sort_order: Number(e.target.value) })
                }
              />
              <small>Lower numbers appear first.</small>
            </label>
          </div>
          {fields.kind === "customer" && (
            <label className="gallery-check">
              <input
                type="checkbox"
                checked={fields.featured}
                disabled={busy}
                onChange={(e) =>
                  setFields({ ...fields, featured: e.target.checked })
                }
              />
              <span>Feature on homepage</span>
            </label>
          )}
          <label className="gallery-check">
            <input
              type="checkbox"
              checked={fields.published}
              disabled={busy}
              onChange={(e) =>
                setFields({ ...fields, published: e.target.checked })
              }
            />
            <span>
              Show on public website
              <small>Uncheck to keep this photo hidden.</small>
            </span>
          </label>
          {error && (
            <p className="gallery-error" role="alert">
              {error}
            </p>
          )}
          <div className="gallery-toolbar">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy
                ? "Saving…"
                : fields.published
                  ? "Save & publish"
                  : "Save hidden photo"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
