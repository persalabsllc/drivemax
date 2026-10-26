"use client";
import type { Person } from "../lib/people";
export function PersonFields({
  value,
  onChange,
  prefix,
  complete = false,
}: {
  value: Person;
  onChange: (p: Person) => void;
  prefix: string;
  complete?: boolean;
}) {
  const field = (
    key: keyof Person,
    label: string,
    required = false,
    type = "text",
    max = 250,
  ) => (
    <label key={key}>
      {label}
      <input
        aria-label={`${prefix} ${label}`}
        value={String(value[key] ?? "")}
        type={type}
        maxLength={max}
        required={required}
        onChange={(e) =>
          onChange({
            ...value,
            [key]: key.includes("state")
              ? e.target.value.toUpperCase()
              : e.target.value,
          })
        }
      />
    </label>
  );
  return (
    <div className="person-fields">
      <div className="form-grid names-grid">
        {field("first_name", "First name", true)}
        {field("middle_name", "Middle name")}
        {field("last_name", "Last name", true)}
        <label>
          Suffix
          <select
            aria-label={`${prefix} Suffix`}
            value={value.suffix}
            onChange={(e) => onChange({ ...value, suffix: e.target.value })}
          >
            <option value="">None</option>
            {["Jr.", "Sr.", "II", "III", "IV", "V"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        {field("phone", "Phone", false, "tel", 30)}
        {field("email", "Email", false, "email")}
        {field("license_state", "Driver’s license state", complete, "text", 2)}
        {field(
          "license_number",
          "Driver’s license number",
          complete,
          "text",
          40,
        )}
      </div>
      <h4>Residential address</h4>
      <div className="form-grid">
        {field("address1", "Street address", complete)}
        {field("address2", "Apartment / suite")}
        {field("city", "City", complete)}
        {field("state", "State", complete, "text", 2)}
        {field("zip", "ZIP code", complete, "text", 15)}
        {field("county", "County")}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={value.mailing_different}
          onChange={(e) =>
            onChange({ ...value, mailing_different: e.target.checked })
          }
        />
        Mailing address is different
      </label>
      {value.mailing_different && (
        <div className="form-grid">
          {field("mailing_address1", "Mailing street address", true)}
          {field("mailing_address2", "Mailing apartment / suite")}
          {field("mailing_city", "Mailing city", true)}
          {field("mailing_state", "Mailing state", true, "text", 2)}
          {field("mailing_zip", "Mailing ZIP code", true, "text", 15)}
        </div>
      )}
    </div>
  );
}
