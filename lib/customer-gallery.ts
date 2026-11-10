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
  {
    id: "d9a11000-0000-4000-8000-000000000006",
    src: "/customers/fusion-driveway-delivery.webp",
    alt: "A Drive Max customer beside a white Ford Fusion with its driver door open in a driveway",
    caption: "A new adventure in a Fusion",
    kind: "customer",
    featured: false,
    sort_order: 60,
    taken_year: 2024,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000007",
    src: "/customers/cobalt-returning-customer.webp",
    alt: "A returning Drive Max customer beside a blue Chevrolet Cobalt outside the original office",
    caption: "Back for another set of keys",
    kind: "customer",
    featured: false,
    sort_order: 70,
    taken_year: 2020,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000008",
    src: "/customers/christmas-eve-family-delivery.webp",
    alt: "Three Drive Max customers standing together in front of their Dodge Grand Caravan",
    caption: "A Christmas Eve delivery",
    kind: "customer",
    featured: false,
    sort_order: 80,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000009",
    src: "/customers/mini-cooper-delivery.webp",
    alt: "Two smiling Drive Max customers beside their Mini Cooper at an evening delivery",
    caption: "Mini Cooper, big smiles",
    kind: "customer",
    featured: false,
    sort_order: 90,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000010",
    src: "/customers/nissan-doorstep-delivery.webp",
    alt: "Two smiling customers in front of a dark Nissan delivered by Drive Max",
    caption: "Delivered to her door",
    kind: "customer",
    featured: false,
    sort_order: 100,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000011",
    src: "/customers/crv-couple-delivery.webp",
    alt: "Two Drive Max customers beside a red Honda CR-V with its driver door open",
    caption: "Ready for the road together",
    kind: "customer",
    featured: false,
    sort_order: 110,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000012",
    src: "/customers/sienna-delivery.webp",
    alt: "A Drive Max customer beside a blue Toyota Sienna outside the original office",
    caption: "A new chapter with a Sienna",
    kind: "customer",
    featured: false,
    sort_order: 120,
    taken_year: 2019,
  },
  {
    id: "d9a11000-0000-4000-8000-000000000013",
    src: "/customers/drive-max-office-exterior.webp",
    alt: "Exterior view of the Drive Max office, gravel driveway, and vehicle lot in New Bern",
    caption: "Drive Max office & lot",
    kind: "exterior",
    featured: false,
    sort_order: 0,
    taken_year: null,
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
