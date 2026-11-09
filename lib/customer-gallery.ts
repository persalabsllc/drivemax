export type GalleryPhoto = {
  id: string;
  src: string;
  alt: string;
  caption: string;
  kind: "customer" | "exterior" | "interior";
  featured: boolean;
  sort_order: number;
  taken_year: number | null;
};

// Local preview data only. Production reads the published gallery in the CRM.
export const galleryPreview: GalleryPhoto[] = [
  {
    id: "d9a11000-0000-4000-8000-000000000001",
    src: "/customers/honda-delivery.webp",
    alt: "A Drive Max customer beside her Honda minivan on delivery day",
    caption: "A new set of keys",
    kind: "customer",
    featured: true,
    sort_order: 10,
    taken_year: 2020,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000002",
    src: "/customers/escape-delivery.webp",
    alt: "A Drive Max customer with his red Ford Escape",
    caption: "Ready for the road",
    kind: "customer",
    featured: true,
    sort_order: 20,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000003",
    src: "/customers/delivery-day-smiles.webp",
    alt: "Two smiling Drive Max customers celebrating inside the original office",
    caption: "Delivery-day smiles",
    kind: "customer",
    featured: true,
    sort_order: 30,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000004",
    src: "/customers/new-car-memories.webp",
    alt: "Two customers with their blue car outside the original Drive Max office",
    caption: "The start of a new adventure",
    kind: "customer",
    featured: true,
    sort_order: 40,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000005",
    src: "/customers/equinox-delivery.webp",
    alt: "Two Drive Max customers with their Chevrolet Equinox on an evening delivery",
    caption: "One more happy drive home",
    kind: "customer",
    featured: false,
    sort_order: 50,
    taken_year: 2019,
  },
];

export function featuredCustomerPhotos(photos: GalleryPhoto[]) {
  return photos.filter((p) => p.kind === "customer" && p.featured).slice(0, 4);
}

export function officePhotos(
  photos: GalleryPhoto[],
  kind?: "exterior" | "interior",
) {
  return photos
    .filter((p) => (kind ? p.kind === kind : p.kind !== "customer"))
    .slice(0, kind ? 1 : 2);
}
