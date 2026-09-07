"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveVehicle } from "./actions";
import { vehicleStatuses, type Vehicle } from "../../lib/inventory";
import {
  mergeDecodedFields,
  mergeFeatureLines,
  type DecodedFields,
  type DecodedVehicle,
} from "../../lib/vehicle-data";
import VinLookup from "../_components/VinLookup";
import SafetyRatings from "./SafetyRatings";

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
  const [decoding, setDecoding] = useState(false);
  const [vin, setVin] = useState(vehicle?.vin || "");
  const [fields, setFields] = useState({
    year: vehicle ? String(vehicle.year) : "",
    make: vehicle?.make || "",
    model: vehicle?.model || "",
    trim: vehicle?.trim || "",
    body_style: vehicle?.body_style || "",
    transmission: vehicle?.transmission || "",
    fuel: vehicle?.fuel || "",
    drivetrain: vehicle?.drivetrain || "",
  });
  const [features, setFeatures] = useState(vehicle?.features.join("\n") || "");
  const previousDecode = useRef<DecodedFields>({});
  const previousFeatures = useRef<string[]>([]);
  const ratingIdentity = `${vin}/${fields.year}/${fields.make}/${fields.model}/${fields.drivetrain}`;
  const previousRatingIdentity = useRef(ratingIdentity);
  useEffect(() => {
    if (previousRatingIdentity.current !== ratingIdentity) {
      setFeatures((current) =>
        current
          .split("\n")
          .filter((line) => !line.trim().startsWith("NHTSA "))
          .join("\n"),
      );
      previousRatingIdentity.current = ratingIdentity;
    }
  }, [ratingIdentity]);
  const applyDecoded = useCallback((data: DecodedVehicle) => {
    const previous = previousDecode.current,
      oldFeatures = previousFeatures.current;
    setFields((current) => mergeDecodedFields(current, data.fields, previous));
    setFeatures((current) =>
      mergeFeatureLines(current, oldFeatures, data.features),
    );
    previousDecode.current = data.fields;
    previousFeatures.current = data.features;
    setDirty(true);
  }, []);
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
        if (decoding || uploading || busy) return;
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
        <VinLookup
          vin={vin}
          onVinChange={setVin}
          onDecoded={applyDecoded}
          onBusyChange={setDecoding}
          initialVin={vehicle?.vin || ""}
          disabled={busy || uploading}
        />
        <p className="cr-muted">
          VIN lookup fills blank fields and adds reported specifications to
          Features. Existing details stay editable. Confirm equipment on the
          vehicle before publishing.
        </p>
        <div className="cr-grid three">
          <label>
            Year
            <input
              name="year"
              type="number"
              required
              min="1900"
              max={new Date().getFullYear() + 2}
              value={fields.year}
              onChange={(e) =>
                setFields((current) => ({ ...current, year: e.target.value }))
              }
            />
          </label>
          <label>
            Make
            <input
              name="make"
              required
              maxLength={60}
              value={fields.make}
              onChange={(e) =>
                setFields((current) => ({ ...current, make: e.target.value }))
              }
            />
          </label>
          <label>
            Model
            <input
              name="model"
              required
              maxLength={80}
              value={fields.model}
              onChange={(e) =>
                setFields((current) => ({ ...current, model: e.target.value }))
              }
            />
          </label>
          <label>
            Trim
            <input
              name="trim"
              maxLength={100}
              value={fields.trim}
              onChange={(e) =>
                setFields((current) => ({ ...current, trim: e.target.value }))
              }
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
            Vehicle price ($), before dealer fee
            <input
              name="internet_price"
              type="number"
              min="1"
              max="2000000"
              step="0.01"
              required
              defaultValue={vehicle?.internet_price}
              aria-describedby="vehicle-price-help"
            />
            <small id="vehicle-price-help">
              Enter the vehicle price only. The website adds the $399 dealer
              administration fee to the displayed total; tax and tags are extra.
            </small>
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
                maxLength={name === "transmission" ? 80 : 60}
                {...(name === "exterior"
                  ? { defaultValue: vehicle?.exterior }
                  : {
                      value: fields[name],
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                        setFields((current) => ({
                          ...current,
                          [name]: e.target.value,
                        })),
                    })}
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
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
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
        <SafetyRatings
          key={ratingIdentity}
          year={fields.year}
          make={fields.make}
          model={fields.model}
          disabled={busy || uploading || decoding}
          onImport={(incoming) => {
            setFeatures((current) =>
              mergeFeatureLines(
                current,
                current.split("\n").filter((line) => line.startsWith("NHTSA ")),
                incoming,
              ),
            );
            setDirty(true);
          }}
        />
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
        <button
          className="button button-primary"
          disabled={busy || uploading || decoding}
        >
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
