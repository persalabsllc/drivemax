import { z } from "zod";
import type { DealFile } from "./sales-work";
export const documentKinds = {
  signed: "Signed paperwork",
  packet: "Deal packet",
  title: "Title & registration",
  purchase: "Purchase / auction",
  service: "Service & recon",
  insurance: "Insurance",
  identification: "Identification",
  stipulation: "Lender stipulation",
  other: "Other",
} as const;
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
export const documentMetadata = z
  .object({
    customer_id: z.uuid().nullable(),
    opportunity_id: z.uuid().nullable(),
    inventory_id: z.uuid().nullable(),
    kind: z.enum(
      Object.keys(documentKinds) as [
        keyof typeof documentKinds,
        ...(keyof typeof documentKinds)[],
      ],
    ),
    document_date: z.iso.date(),
    notes: z.string().trim().max(2000).default(""),
  })
  .refine(
    (v) => v.customer_id || v.inventory_id,
    "Choose a customer or stock number.",
  )
  .refine(
    (v) => !v.opportunity_id || v.customer_id,
    "Choose the opportunity's customer.",
  );
export type DocumentMetadata = z.infer<typeof documentMetadata>;
export const prepareDocumentSchema = documentMetadata.and(
  z.object({
    name: z.string().min(1).max(200),
    size: z.number().int().min(1).max(MAX_DOCUMENT_SIZE),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  }),
);
export function documentMime(bytes: Uint8Array) {
  if (String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  return null;
}
export function fileSize(size: number) {
  return size < 1048576
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1048576).toFixed(1)} MB`;
}
export function documentMatches(file: DealFile, query: string, extra = "") {
  const haystack = [
    file.name,
    file.customer_name,
    file.stock_number,
    file.vin,
    file.vehicle_label,
    file.notes,
    extra,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
