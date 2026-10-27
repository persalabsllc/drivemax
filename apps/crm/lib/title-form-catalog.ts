import { dmvForms } from "./title-clerk";

export const titleFormGroups = [
  {
    label: "Everyday deal paperwork",
    forms: [
      ...dmvForms.map((f) => ({
        ...f,
        help: "Saved buyer and vehicle information; review before printing.",
      })),
      {
        id: "MVR-2",
        label: "Dealer reassignment",
        detail: "MVR-2 · Preprinted form",
        help: "Print typed entries on your original MVR-2, with section selection and printer alignment.",
      },
    ],
  },
  {
    label: "Registration and special ownership",
    forms: [
      {
        id: "MVR-614",
        label: "Non-resident title affidavit",
        detail: "MVR-614",
        help: "For an eligible non-resident titling in NC. Enter the NC vehicle location and permanent home address separately.",
      },
      {
        id: "MVR-330",
        label: "Leased vehicle registration",
        detail: "MVR-330 · Non-owner / lessee",
        help: "Registration or plate transfer for a leased vehicle. Enter and verify the lessor and lessee.",
      },
      {
        id: "MVR-1A",
        label: "Plate and address certification",
        detail: "MVR-1A",
        help: "Registration plate and address certification. Review the selected plate request and vehicle location.",
      },
      {
        id: "MVR-620",
        label: "Joint ownership / survivorship",
        detail: "MVR-620",
        help: "Joint tenants with right of survivorship. Review both owners and their ownership choice.",
      },
      {
        id: "MVR-613",
        label: "Highway-use tax exemption",
        detail: "MVR-613",
        help: "Only for an applicable exemption. Select the correct certification; this form does not change the deal’s saved taxes.",
      },
    ],
  },
  {
    label: "Title corrections and liens",
    forms: [
      {
        id: "MVR-6TT",
        label: "Title in transit",
        detail: "MVR-6TT",
        help: "For an original title that is unavailable. Review the title-in-transit certifications.",
      },
      {
        id: "MVR-4",
        label: "Duplicate title",
        detail: "MVR-4",
        help: "Request a duplicate title. Confirm the owner and lienholder shown on the existing title.",
      },
      {
        id: "MVR-5",
        label: "Corrected / substitute title",
        detail: "MVR-5 · 2 pages",
        help: "Correct title information. Confirm the existing titled owner, explain the correction and review both pages.",
      },
      {
        id: "MVR-28",
        label: "Incorrect title assignment",
        detail: "MVR-28",
        help: "Affidavit for an incorrect assignment. Enter the incorrectly assigned and actually delivered vehicles separately.",
      },
      {
        id: "MVR-6",
        label: "Record a lien",
        detail: "MVR-6",
        help: "Add a lien to an existing title. Confirm the titled owner and lienholder details.",
      },
      {
        id: "MVR-8",
        label: "Remove a lien",
        detail: "MVR-8",
        help: "Apply to remove a lien. Confirm the titled owner and the lien being removed.",
      },
      {
        id: "MVR-46D",
        label: "NC lienholder release",
        detail: "MVR-46D",
        help: "Release by a North Carolina lienholder. Verify the existing title and lienholder; authorization stays blank for signing.",
      },
    ],
  },
] as const;
export const titleFormCatalog = titleFormGroups.flatMap((g) => [...g.forms]);
