import { z } from "zod";

export const galleryKinds = ["customer", "exterior", "interior"] as const;
export const galleryFields = z
  .object({
    caption: z.string().trim().max(160).default(""),
    alt: z.string().trim().min(3, "Describe what is in this photo.").max(240),
    kind: z.enum(galleryKinds),
    featured: z.boolean(),
    published: z.boolean(),
    sort_order: z.number().int().min(0).max(99999),
    taken_year: z.number().int().min(2019).max(2100).nullable(),
  })
  .refine((p) => !p.featured || p.kind === "customer", {
    message: "Only customer photos can be featured on the homepage.",
  });
export const galleryUpdate = z.object({
  id: z.string().uuid(),
  updated_at: z.string().min(10).max(50),
  fields: galleryFields,
});
export type GalleryFields = z.infer<typeof galleryFields>;
export type GalleryPhoto = GalleryFields & {
  id: string;
  updated_at: string;
  preview: string;
};
export const galleryKindLabel = (kind: string) =>
  ({
    customer: "Customer delivery",
    exterior: "Office exterior",
    interior: "Office interior",
  })[kind] || kind;
