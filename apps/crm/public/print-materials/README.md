# Inventory print assets

`ftc-buyers-guide-en.pdf` is the unmodified, static FTC Buyers Guide:
https://www.ftc.gov/system/files/documents/plain-language/buyersguide_eng_2016-11.pdf
Retrieved October 26, 2026. Pages: as-is/dealer-warranty front, implied-warranties-only front, common reverse.

The generator copies the applicable front and reverse, then fills only the intended blanks and checkboxes. Preserve the official wording, layout, black ink, and US Letter page size. Do not add a dealer logo to the Buyers Guide.

`drive-max-logo.png` is a lossless PNG conversion of the CRM's `drive-max-logo.webp`, for embedding in the window sticker.

Default warranty terms come from `assets/forms/Drive_Max_Limited_Powertrain_Warranty.pdf` (DM-W01, Rev 10/2026). Edits in the print dialog apply only to the printed documents; they do not amend that separate written warranty or inventory records.

## Window sticker specifications

The sticker is a dealer-created document, not a reproduction of the manufacturer's original label. Its total asking price includes the separately itemized administration fee; tax, title, registration and optional products are excluded.

The authenticated `/api/vehicle-specifications` route uses two public sources with no paid API subscription or API key:

- NHTSA vPIC: https://vpic.nhtsa.dot.gov/api/ — VIN-reported engine, horsepower, drivetrain and equipment. Missing values stay blank. Equipment is imported only when reported as standard or explicitly identified (such as airbags); optional and unknown features are not asserted. Flagged VINs or mismatched vehicle identities are not imported.
- FuelEconomy.gov: https://www.fueleconomy.gov/feg/ws/index.shtml — year/make/model configuration menus and primary-fuel city/highway/combined ratings. Staff must select the matching engine/transmission/drivetrain. Electricity ratings use MPGe; plug-in hybrid gasoline-mode ratings are labeled as such. Manual edits remove the EPA attribution.

Specifications and equipment remain editable and apply only to the current printout. Neither lookup nor printing writes inventory. External data requests have timeouts and a one-day cache; provider failures leave manual entry available. The printed footer identifies the data sources and reminds buyers to verify installed equipment.
