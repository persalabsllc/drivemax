"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveVehicle } from "./actions";
import { vehicleStatuses, type Vehicle } from "../../lib/inventory";

export default function VehicleEditor({
  vehicle,
  photoBase,
}: {
  vehicle: Vehicle | null;
  photoBase: string;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState(vehicle?.photos || []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  function reorder(index: number, step: number) {
    const next = [...photos];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setPhotos(next);
    setDirty(true);
  }
  async function upload(files: FileList | null) {
    if (!files || !vehicle) return;
    if (photos.length + files.length > 40) {
      setNotice("Up to 40 photos per vehicle.");
      setError(true);
      return;
    }
    setUploading(true);
    setError(false);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.set("vehicleId", vehicle.id);
        body.set("file", file);
        const response = await fetch("/api/control-room/photos", {
          method: "POST",
          body,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Photo upload failed.");
        setPhotos((current) => [...current, data.path]);
        setDirty(true);
      }
      setNotice(
        "Photos uploaded. Save the vehicle to publish this photo order.",
      );
    } catch (e) {
      setError(true);
      setNotice(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      className="cr-panel cr-form"
      ref={formRef}
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(false);
        setNotice("");
        try {
          const result = await saveVehicle(new FormData(e.currentTarget));
          setNotice(result.error || result.message || "");
          setError(!!result.error);
          if (!result.error) {
            setDirty(false);
            router.push(`/control-room?tab=inventory&vehicle=${result.id}`);
            router.refresh();
          }
        } catch {
          setError(true);
          setNotice("Could not save. Your edits are still here; try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="cr-section-heading">
        <div>
          <span className="kicker">Inventory editor</span>
          <h2>{vehicle ? "Vehicle details" : "Add a vehicle"}</h2>
        </div>
        {vehicle && (
          <Link
            className="text-link"
            href={`/inventory/${vehicle.slug}`}
            target="_blank"
          >
            View listing ↗
          </Link>
        )}
      </div>
      <input type="hidden" name="id" value={vehicle?.id || ""} />
      <input
        type="hidden"
        name="updated_at"
        value={vehicle?.updated_at || ""}
      />
      <fieldset disabled={busy || uploading} className="cr-fieldset">
        <div className="cr-grid three">
          <label>
            Year
            <input
              name="year"
              type="number"
              required
              min="1900"
              max={new Date().getFullYear() + 2}
              defaultValue={vehicle?.year || new Date().getFullYear()}
            />
          </label>
          <label>
            Make
            <input
              name="make"
              required
              maxLength={60}
              defaultValue={vehicle?.make}
            />
          </label>
          <label>
            Model
            <input
              name="model"
              required
              maxLength={80}
              defaultValue={vehicle?.model}
            />
          </label>
          <label>
            Trim
            <input name="trim" maxLength={100} defaultValue={vehicle?.trim} />
          </label>
          <label>
            VIN
            <input
              name="vin"
              required
              minLength={17}
              maxLength={17}
              defaultValue={vehicle?.vin}
            />
          </label>
          <label>
            Stock number
            <input
              name="stock_number"
              required
              maxLength={40}
              defaultValue={vehicle?.stock_number}
            />
          </label>
          <label>
            Mileage
            <input
              name="miles"
              type="number"
              min="0"
              max="2000000"
              required
              defaultValue={vehicle?.miles}
            />
          </label>
          <label>
            Internet price ($)
            <input
              name="internet_price"
              type="number"
              min="1"
              max="2000000"
              step="0.01"
              required
              defaultValue={vehicle?.internet_price}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={vehicle?.status || "draft"}>
              {vehicleStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["body_style", "Body style"],
              ["exterior", "Exterior color"],
              ["transmission", "Transmission"],
              ["drivetrain", "Drivetrain"],
              ["fuel", "Fuel"],
            ] as const
          ).map(([name, label]) => (
            <label key={name}>
              {label}
              <input
                name={name}
                maxLength={60}
                defaultValue={vehicle?.[name]}
              />
            </label>
          ))}
        </div>
        <label className="cr-check">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={vehicle?.featured}
          />{" "}
          Feature on the homepage when available
        </label>
        <div className="cr-status-help">
          Available: homepage and search · Pending: direct listing only · Sold:
          sold section and detail page · Draft / archived: hidden
        </div>
        <label>
          Description
          <textarea
            name="description"
            rows={6}
            maxLength={12000}
            defaultValue={vehicle?.description}
            placeholder="Condition, highlights, recent service, and what makes this vehicle a good fit."
          />
        </label>
        <div className="cr-grid">
          <label>
            Features <span className="cr-muted">— one per line</span>
            <textarea
              name="features"
              rows={6}
              defaultValue={vehicle?.features.join("\n")}
              placeholder={"Backup camera\nBluetooth\nHeated seats"}
            />
          </label>
          <label>
            Financing options
            <textarea
              name="financing"
              rows={6}
              maxLength={4000}
              defaultValue={vehicle?.financing}
              placeholder="Describe available financing options and applicable terms for this vehicle."
            />
          </label>
        </div>
        <div>
          <h3>Vehicle photos</h3>
          <p className="cr-muted">
            First photo is the cover. JPG, PNG, or WebP; under 4 MB each. Up to
            40 photos.
          </p>
          {vehicle ? (
            <label className="cr-upload">
              Add photos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="cr-status-help">
              Save as a draft first, then add photos and publish.
            </p>
          )}
          <div className="cr-photos">
            {photos.map((path, i) => (
              <div className="cr-photo" key={path}>
                <input type="hidden" name="photos" value={path} />
                <Image
                  src={`${photoBase}${path}`}
                  alt={`Vehicle photo ${i + 1}`}
                  width={320}
                  height={240}
                />
                <span>{i === 0 ? "Cover photo" : `Photo ${i + 1}`}</span>
                <div>
                  <button
                    type="button"
                    aria-label={`Move photo ${i + 1} earlier`}
                    disabled={!i}
                    onClick={() => reorder(i, -1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={`Move photo ${i + 1} later`}
                    disabled={i === photos.length - 1}
                    onClick={() => reorder(i, 1)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotos((current) => current.filter((p) => p !== path));
                      setDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </fieldset>
      <div className="cr-savebar">
        <span>
          {uploading
            ? "Uploading photos…"
            : dirty
              ? "Unsaved changes"
              : vehicle
                ? "All changes saved"
                : "Start with the vehicle basics"}
        </span>
        <button className="button button-primary" disabled={busy || uploading}>
          {busy ? "Saving…" : "Save vehicle"}
        </button>
      </div>
      <p
        className={error ? "cr-error" : "cr-success"}
        role={error ? "alert" : "status"}
      >
        {notice}
      </p>
    </form>
  );
}
