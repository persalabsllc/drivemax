"use client";

export function ProtectionTermChoices({
  months,
  miles,
  annualMiles = 12000,
  onChange,
  disabled = false,
}: {
  months: number;
  miles: number;
  annualMiles?: number;
  onChange: (months: number, miles: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="protection-term-choices"
      role="group"
      aria-label="Quick coverage terms"
    >
      <span>Quick coverage</span>
      {[6, 12, 24, 36].map((term) => {
        const coveredMiles = Math.round((annualMiles * term) / 12);
        return (
          <button
            key={term}
            type="button"
            className="btn"
            disabled={disabled}
            aria-pressed={months === term && miles === coveredMiles}
            onClick={() => onChange(term, coveredMiles)}
          >
            {term} months / {coveredMiles.toLocaleString()} miles
          </button>
        );
      })}
    </div>
  );
}
