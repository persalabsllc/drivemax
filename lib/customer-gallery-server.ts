import "server-only";
import { cache } from "react";
import { backendReady, db } from "./backend";
import { galleryPreview, type GalleryPhoto } from "./customer-gallery";

export const GALLERY_ORG = "d5a1c100-0000-4000-8000-000000000001";
export const publicGallery = cache(async (): Promise<GalleryPhoto[]> => {
  if (!backendReady())
    return process.env.NODE_ENV === "production" ? [] : galleryPreview;
  try {
    const { data, error } = await db()
      .from("dmcrm_site_photos")
      .select(
        "id,seed_path,caption,alt,kind,featured,sort_order,taken_year,updated_at",
      )
      .eq("org_id", GALLERY_ORG)
      .eq("published", true)
      .order("sort_order")
      .order("id")
      .limit(500);
    if (error) throw error;
    return (data || []).map(({ seed_path, updated_at, ...photo }) => ({
      ...photo,
      src:
        seed_path ||
        `/api/gallery/photos/${photo.id}?v=${encodeURIComponent(updated_at)}`,
    })) as GalleryPhoto[];
  } catch {
    console.warn("Published customer gallery unavailable");
    // Never fall back to old photos after a manager has unpublished them.
    return [];
  }
});
