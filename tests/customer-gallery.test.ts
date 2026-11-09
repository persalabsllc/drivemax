import { test } from "node:test";
import assert from "node:assert/strict";
import {
  galleryPreview,
  featuredCustomerPhotos,
  officePhotos,
} from "../lib/customer-gallery";

test("homepage remains bounded as the gallery grows and office photos stay separate", () => {
  const customers = Array.from({ length: 20 }, (_, i) => ({
    ...galleryPreview[0],
    id: `photo-${i}`,
    featured: true,
  }));
  const exterior = {
    ...galleryPreview[0],
    id: "office",
    kind: "exterior" as const,
    featured: false,
  };
  assert.equal(featuredCustomerPhotos([...customers, exterior]).length, 4);
  assert.deepEqual(officePhotos([...customers, exterior]), [exterior]);
  assert.deepEqual(officePhotos(galleryPreview), []);
  assert.deepEqual(
    featuredCustomerPhotos(customers.map((p) => ({ ...p, featured: false }))),
    [],
  );
});
