import type { Metadata, MetadataRoute } from "next";
import type { Vehicle } from "./inventory";
import { APPOINTMENT_NOTE, REGULAR_OPENING_HOURS } from "./business-hours";

export const SITE_URL = "https://www.drivemaxusedcars.com";
export const SITE_NAME = "Drive Max Used Cars";
export const SERVICE_AREAS = [
  "New Bern",
  "Havelock",
  "Jacksonville",
  "Kinston",
  "Dover",
  "Cove City",
  "Trent Woods",
  "James City",
  "Greenville",
] as const;

export const PUBLIC_PAGES = [
  {
    path: "/",
    label: "Home",
    description: "Get to know Drive Max and browse featured vehicles.",
  },
  {
    path: "/inventory",
    label: "Used car inventory",
    description: "See photos, mileage, pricing, and vehicle details.",
  },
  {
    path: "/sell-your-car",
    label: "Sell your car",
    description: "Share your vehicle details to request a purchase offer.",
  },
  {
    path: "/apply",
    label: "Financing options",
    description: "Start a conversation about vehicle financing.",
  },
  {
    path: "/about",
    label: "About Drive Max",
    description: "Our family-owned dealership and approach to service.",
  },
  {
    path: "/about/staff",
    label: "Meet the staff",
    description: "Meet Kyle and get to know our team’s roles.",
  },
  {
    path: "/about/employment",
    label: "Employment",
    description: "Tell us about your interest in joining our team.",
  },
  {
    path: "/areas-we-serve",
    label: "Areas we serve",
    description:
      "Shopping from New Bern and surrounding eastern NC communities.",
  },
  {
    path: "/contact",
    label: "Contact & directions",
    description: "Ask a question or plan your visit to New Bern.",
  },
  {
    path: "/payments",
    label: "Payment help",
    description: "Get help with an existing Drive Max account.",
  },
  {
    path: "/privacy-policy",
    label: "Privacy Policy",
    description: "How we handle your information and contact preferences.",
  },
  {
    path: "/site-map",
    label: "Site map",
    description: "Find the public pages on our website.",
  },
] as const;

export function absoluteUrl(path: string) {
  return new URL(path, `${SITE_URL}/`).toString();
}

export function pageMetadata({
  title,
  description,
  path,
  image,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const socialTitle = `${title} | ${SITE_NAME}`;
  const shareImage = image
    ? { url: image, alt: title }
    : {
        url: absoluteUrl("/drive-max-logo-transparent.webp"),
        width: 1064,
        height: 532,
        alt: SITE_NAME,
      };
  return {
    title: { absolute: socialTitle },
    description,
    alternates: { canonical: absoluteUrl(path) },
    ...(noIndex || process.env.VERCEL_ENV === "preview"
      ? { robots: { index: false, follow: true } }
      : {}),
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: SITE_NAME,
      title: socialTitle,
      description,
      url: absoluteUrl(path),
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [shareImage],
    },
  };
}

export function inventoryPageMetadata(
  params: Record<string, string | string[] | undefined>,
): Metadata {
  const filtered = ["q", "body", "max"].some((key) => !!params[key]);
  const query = new URLSearchParams();
  for (const key of ["page", "soldPage"]) {
    const page = typeof params[key] === "string" ? Number(params[key]) : 1;
    if (Number.isFinite(page) && page > 1)
      query.set(key, String(Math.floor(page)));
  }
  return pageMetadata({
    title: "Used Car Inventory in New Bern, NC",
    description:
      "Shop used cars, trucks, and SUVs at Drive Max in New Bern, serving Havelock and eastern NC. View photos, mileage, clear pricing, and test-drive requests.",
    path: `/inventory${!filtered && query.size ? `?${query}` : ""}`,
    noIndex: filtered,
  });
}

export function siteRobots(
  preview = process.env.VERCEL_ENV === "preview",
): MetadataRoute.Robots {
  return preview
    ? { rules: { userAgent: "*", disallow: "/" } }
    : {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: ["/control-room", "/api/"],
        },
        sitemap: absoluteUrl("/sitemap.xml"),
      };
}

// Keep clearly labeled sold listings discoverable; exclude all private stock.
export function buildSitemap(
  vehicles: Pick<Vehicle, "slug" | "status" | "updated_at" | "photos">[],
  photoUrl: (path: string) => string,
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const listings = vehicles.filter((v) => {
    if (
      !["available", "pending", "sold"].includes(v.status) ||
      !v.slug ||
      seen.has(v.slug)
    )
      return false;
    seen.add(v.slug);
    return true;
  });
  return [
    ...PUBLIC_PAGES.map((page) => ({ url: absoluteUrl(page.path) })),
    ...listings.map((v) => ({
      url: absoluteUrl(`/inventory/${encodeURIComponent(v.slug)}`),
      ...(v.updated_at && Number.isFinite(Date.parse(v.updated_at))
        ? { lastModified: v.updated_at }
        : {}),
      ...(v.photos.length
        ? { images: [...new Set(v.photos.map(photoUrl))] }
        : {}),
    })),
  ];
}

export const dealershipSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AutoDealer",
      "@id": `${SITE_URL}/#dealership`,
      name: SITE_NAME,
      legalName: "Drive Max Used Cars LLC",
      url: SITE_URL,
      logo: absoluteUrl("/drive-max-logo-transparent.webp"),
      email: "sales@drivemaxusedcars.com",
      foundingDate: "2019",
      description: `Family-owned used car dealership in New Bern, North Carolina, offering quality used vehicles, financing options, and personal service. ${APPOINTMENT_NOTE}`,
      openingHoursSpecification: REGULAR_OPENING_HOURS,
      address: {
        "@type": "PostalAddress",
        streetAddress: "6210 Old US Hwy 70 West",
        addressLocality: "New Bern",
        addressRegion: "NC",
        postalCode: "28562",
        addressCountry: "US",
      },
      areaServed: SERVICE_AREAS.map((name) => ({
        "@type": "Place",
        name: `${name}, North Carolina`,
      })),
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      publisher: { "@id": `${SITE_URL}/#dealership` },
    },
  ],
};

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
