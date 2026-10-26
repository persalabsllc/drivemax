# Sold-pack PDF templates

`manifest.json` is the ordered form catalog and overlay geometry for 13 one-page sold-pack forms, plus a separate MVR-2 scan used only as a preview. The catalog contains 494 editable native widgets (493 named fields) and 37 MVR-2 overlay controls. Coordinates are PDF points measured from the top left. All page rotations are zero. Use each page's reported dimensions: MVR-63 is 576 × 759.96 points; the other forms are 612 × 792 points.

The eight Drive Max templates preserve the supplied forms and their existing interactive fields. Their printed content has not been rewritten. The five NCDMV templates are the 04/2026 versions retrieved from the official URLs recorded in the manifest. Original source SHA-256 hashes and revisions are included. The user-supplied MVR-2 scan is revision 01/2017.

## Filling and printing

- `name` is the native AcroForm field name. `key`, where present, is a suggested CRM value. Fields without a key remain editable. `defaultValue` records a value already present in the original blank template; it is not an inferred answer.
- `fontSize` is an upper-size suggestion. Fit longer text to its widget, and honor `multiline`. The MVR-1 dealer name/address field is multiline so the full address remains readable.
- Signatures, initials, and notarial fields are excluded from the editor and autofill. Leave them blank. Damage disclosures and other declarations have no inferred checkbox selections.
- Warranty `service_contract_status` is a native radio group. Its two manifest widgets use the same name and distinct `exportValue` values, `Purchased` and `Not purchased`. Select the group once using the chosen export value.
- Fill and flatten each template separately before copying its pages into the packet. This prevents the same field names in different forms from sharing values.
- With pdf-lib, update field appearances using the chosen font before flattening. Its flatten operation can leave dangling child-widget references in `/Annots`; clear page `/Annots` afterward. These templates contain only widget annotations. This was verified using the app's installed pdf-lib dependency.

## MVR-2 preprinted stock

`MVR-2-preview.pdf` is a blank background for the screen only. Never copy its image or page contents into the print result. Create a blank letter page and draw only the vehicle header and fields with the selected `section` value (1, 2, or 3). Do not print the other sections. Checkbox selections are explicit user choices. The `exclusiveGroup` values identify mutually exclusive answers.

Apply printer calibration to the text-only coordinates, and print at Actual size / 100%. Digital alignment against the supplied scan was checked for all three sections. A physical plain-paper alignment test is still needed for the actual printer and stock.

## Preparation changes

- Oversized Drive Max logo images were reduced to 1000 pixels wide at high JPEG quality, retaining 480–563 DPI at their printed size. Text and vector layout are unchanged.
- Default appearance strings use hex PDF strings for consistent parsing by pypdf and pdf-lib. Each widget retains an independent appearance stream; do not deduplicate blank appearance streams.
- Official fields with oversized native default fonts use auto-sizing. MVR-1 dealer name/address has multiline enabled.
- The original MVR-181 PDF uses one shared native field for two different damaged-parts lines. The recovered-theft line is now an independent field named `Recovered theft damaged parts`, preserving both printed labels and positions.

Regenerate assets from the original source PDFs with `scripts/forms/prepare_assets.py --dealer-forms <directory> --dmv-forms <directory> --mvr2 <scan.pdf>`. Source originals are required; do not use already-prepared assets as the input. The script does not download files or modify application code.
