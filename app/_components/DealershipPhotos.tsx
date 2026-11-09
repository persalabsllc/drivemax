import CustomerGallery from "./CustomerGallery";
import { officePhotos, type GalleryPhoto } from "../../lib/customer-gallery";

export default function DealershipPhotos({
  photos,
  exteriorOnly = false,
}: {
  photos: GalleryPhoto[];
  exteriorOnly?: boolean;
}) {
  const selected = officePhotos(photos, exteriorOnly ? "exterior" : undefined);
  if (!selected.length) return null;
  return (
    <div className="dealership-photos">
      <span className="kicker">A look around Drive Max</span>
      <CustomerGallery photos={selected} layout="grid" />
    </div>
  );
}
