import type {
  InventoryTitleDraft,
  InventoryTitleLien,
} from "../lib/inventory-title";

export default function InventoryTitleApplication({
  value,
  onChange,
}: {
  value: InventoryTitleDraft;
  onChange: (value: InventoryTitleDraft) => void;
}) {
  const change = (
    key: Exclude<keyof InventoryTitleDraft, "liens">,
    next: string,
  ) => onChange({ ...value, [key]: next });
  const field = (
    key: Exclude<keyof InventoryTitleDraft, "liens" | "leased">,
    label: string,
    max: number,
    type = "text",
  ) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        type={type}
        maxLength={max}
        {...(key === "mileage" ? { min: 0, max: 3000000, step: 1 } : {})}
        value={value[key]}
        onChange={(e) => change(key, e.target.value)}
      />
    </label>
  );
  const changeLien = (
    index: 0 | 1,
    key: keyof InventoryTitleLien,
    next: string,
  ) => {
    const liens: InventoryTitleDraft["liens"] = [...value.liens];
    liens[index] = { ...liens[index], [key]: next };
    onChange({ ...value, liens });
  };
  return (
    <section
      className="inventory-print-section"
      aria-labelledby="title-application-heading"
    >
      <div className="inventory-print-section-head">
        <h3 id="title-application-heading">Title application — title only</h3>
        <span>Official NC MVR-1</span>
      </div>
      <p className="inventory-title-owner">
        <strong>{value.ownerName}</strong>
        <br />
        {value.address}, {value.city}, {value.state} {value.zip}
      </p>
      <p className="inventory-print-help">
        “Title Only — Vehicle Not in Operation” and “Used” are selected. Vehicle
        identity comes from this inventory record. The PDF opens with editable
        fields for manual adjustments before printing. Initial, sign and
        notarize the printed application.
      </p>
      <div className="inventory-print-grid">
        {field("mileage", "Title application odometer reading", 7, "number")}
        {field("purchaseDate", "Purchase date", 10, "date")}
      </div>
      <details className="inventory-print-details">
        <summary>Owner & business address</summary>
        <div className="inventory-print-grid">
          {field("ownerName", "Title owner / company name", 100)}
          {field("ownerId", "Company owner ID (if known)", 40)}
          {field("address", "Business street address", 150)}
          {field("city", "Business city", 60)}
          {field("state", "Business state", 2)}
          {field("zip", "Business ZIP code", 10)}
          {field("county", "Tax county", 60)}
        </div>
      </details>
      <details className="inventory-print-details">
        <summary>Seller & additional vehicle details</summary>
        <div className="inventory-print-grid">
          {field("body", "Title application body style", 40)}
          {field("fuel", "Title application fuel type", 30)}
          <label>
            Purchased from — name & address
            <textarea
              aria-label="Purchased from — name & address"
              rows={3}
              maxLength={250}
              value={value.purchasedFrom}
              onChange={(e) => change("purchasedFrom", e.target.value)}
            />
          </label>
          {field(
            "sellerDealerNumber",
            "Selling NC dealer number (if applicable)",
            40,
          )}
          <label>
            Is this vehicle leased?
            <select
              aria-label="Is this vehicle leased?"
              value={value.leased}
              onChange={(e) =>
                onChange({
                  ...value,
                  leased: e.target.value as InventoryTitleDraft["leased"],
                })
              }
            >
              <option value="">Leave blank</option>
              <option value="no">No</option>
              <option value="yes">Yes — attach MVR-330</option>
            </select>
          </label>
        </div>
      </details>
      <details className="inventory-print-details">
        <summary>Liens (if applicable)</summary>
        <p className="inventory-print-help">
          Enter any liens that will remain on the title. Unentered lien fields
          print blank.
        </p>
        {([0, 1] as const).map((index) => (
          <fieldset className="inventory-title-lien" key={index}>
            <legend>{index === 0 ? "First" : "Second"} lien</legend>
            <div className="inventory-print-grid">
              {(
                [
                  ["name", "Lienholder name", 100],
                  ["id", "Lienholder ID", 40],
                  ["address", "Lienholder street address", 150],
                  ["city", "Lienholder city", 60],
                  ["state", "Lienholder state", 2],
                  ["zip", "Lienholder ZIP code", 10],
                  ["account", "Lien account number", 60],
                  ["date", "Lien date", 10],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={`${index === 0 ? "First" : "Second"} ${label.toLowerCase()}`}
                    type={key === "date" ? "date" : "text"}
                    maxLength={max}
                    value={value.liens[index][key]}
                    onChange={(e) => changeLien(index, key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </details>
    </section>
  );
}
