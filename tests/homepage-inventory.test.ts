import { test } from "node:test";
import assert from "node:assert/strict";
import { featuredHomepageVehicles } from "../lib/homepage-inventory";
import type { Vehicle } from "../lib/inventory";

const vehicle: Vehicle = {
  id: "0e400b44-3e80-4d19-a9f4-4e283be977d6",
  slug: "test-vehicle",
  year: 2020,
  make: "Toyota",
  model: "Camry",
  trim: "LE",
  vin: "4T1B11HK0KU123456",
  stock_number: "TEST001",
  miles: 85000,
  internet_price: 14995,
  body_style: "Sedan",
  transmission: "Automatic",
  fuel: "Gasoline",
  exterior: "White",
  drivetrain: "FWD",
  description: "A test vehicle.",
  financing: "",
  features: [],
  photos: ["test/front.webp", "test/rear.webp"],
  status: "available",
  featured: true,
  sold_at: null,
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
};
const photoUrl = (path: string) => `https://photos.example.com/${path}`;

test("homepage rotation includes only featured, available vehicles with a cover photo", () => {
  const excluded = [
    { ...vehicle, featured: false },
    ...(["draft", "pending", "sold", "archived"] as const).map((status) => ({
      ...vehicle,
      status,
    })),
    { ...vehicle, photos: [] },
    { ...vehicle, photos: [""] },
  ];
  assert.deepEqual(featuredHomepageVehicles([], photoUrl), []);
  assert.deepEqual(featuredHomepageVehicles(excluded, photoUrl), []);
  const second = { ...vehicle, id: "second", slug: "second-vehicle", miles: 0 };
  const slides = featuredHomepageVehicles(
    [vehicle, ...excluded, second],
    photoUrl,
  );
  assert.equal(slides.length, 2);
  assert.deepEqual(slides[0], {
    id: vehicle.id,
    href: `/inventory/${vehicle.slug}`,
    title: "2020 Toyota Camry LE",
    photo: "https://photos.example.com/test/front.webp",
    price: "$14,995",
    mileage: "85,000 miles",
  });
  assert.equal(slides[1].href, "/inventory/second-vehicle");
  assert.equal(slides[1].mileage, "0 miles");
  assert.equal(featuredHomepageVehicles([vehicle], photoUrl).length, 1);
});
