"use client";
import { useState } from "react";
import Image from "next/image";
export default function VehicleGallery({
  photos,
  title,
}: {
  photos: string[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  if (!photos.length)
    return <div className="vehicle-gallery-main">Photos coming soon</div>;
  return (
    <div>
      <div className="vehicle-gallery-main">
        <Image
          src={photos[index]}
          alt={`${title} — photo ${index + 1}`}
          fill
          sizes="(max-width:980px) 100vw, 65vw"
          priority
        />
      </div>
      <div className="vehicle-thumbnails">
        {photos.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show photo ${i + 1}`}
            aria-pressed={index === i}
          >
            <Image src={src} alt="" width={140} height={100} />
          </button>
        ))}
      </div>
    </div>
  );
}
