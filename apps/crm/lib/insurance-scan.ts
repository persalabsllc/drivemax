import type { Insurance } from "./people";
export type InsuranceScan = {
  suggestions: Partial<Insurance>;
  warnings: string[];
  vin: string | null;
};
function cardDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})\b/);
  if (!m) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year >= 70 ? 1900 : 2000;
  const value = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(value + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? value
    : null;
}
const datePattern = /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{4}|\d{2})\b/g;
const labels =
  /\b(?:effective|expiration|expires|expiry|insured|vehicle|policy|agent|year|make|model|NAIC)\b/i;
export function parseInsuranceText(raw: string): InsuranceScan {
  const lines = raw
    .slice(0, 30000)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const suggestions: Partial<Insurance> = {},
    warnings: string[] = [];
  const insurers =
    /\b(?:GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|NATIONWIDE|USAA|ERIE|DIRECT AUTO|NATIONAL GENERAL|FARM BUREAU|TRAVELERS|LIBERTY MUTUAL|FARMERS|AUTO-OWNERS|ROOT INSURANCE|THE GENERAL)\b/i;
  const known = lines.find((l) => insurers.test(l) && !/^agent\b/i.test(l));
  if (known)
    suggestions.company = known
      .replace(/^\s*(?:company|insurer|carrier)\s*[:#-]?\s*/i, "")
      .slice(0, 250);
  if (!suggestions.company) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(
        /^(?:insurance company|company|insurer|carrier)\s*[:#-]?\s*(.*)$/i,
      );
      if (match) {
        const candidate = match[1] || lines[i + 1] || "";
        if (
          candidate.length > 2 &&
          !labels.test(candidate) &&
          !/^\d+$/.test(candidate)
        ) {
          suggestions.company = candidate.slice(0, 250);
          break;
        }
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(
      /\bpolicy\s*(?:number|no\.?|#|:)\s*[:#-]?\s*(.*)$/i,
    );
    if (m && !suggestions.policy_number) {
      let tail = m[1];
      if (!tail || labels.test(tail.split(/\s+/)[0] ?? ""))
        tail = lines[i + 1] ?? "";
      // Do not silently correct O/0 or I/1 in an identifier.
      const token = tail.match(/^([A-Z0-9][A-Z0-9-]{2,59})(?:\s|$)/i)?.[1];
      if (token && /\d/.test(token) && !cardDate(token))
        suggestions.policy_number = token;
    }
    const combined =
      /effective/i.test(lines[i]) && /(?:expir|expires)/i.test(lines[i]);
    if (combined || /policy\s+(?:period|term)/i.test(lines[i])) {
      const dates =
        (lines[i] + " " + (lines[i + 1] ?? "")).match(datePattern) ?? [];
      if (dates.length >= 2) {
        const start = cardDate(dates[0]!),
          end = cardDate(dates[1]!);
        if (start) suggestions.effective_from = start;
        if (end) suggestions.effective_to = end;
      }
    } else {
      for (const [label, key] of [
        [/\b(?:effective|eff\.?)\b/i, "effective_from"],
        [/\b(?:expiration|expires|expiry|exp\.?)\b/i, "effective_to"],
      ] as const) {
        const at = lines[i].search(label);
        if (at < 0) continue;
        const suffix = lines[i].slice(at).replace(label, "");
        const found =
          cardDate(suffix) ||
          (!labels.test(lines[i + 1] ?? "")
            ? cardDate(lines[i + 1] ?? "")
            : null);
        if (found) suggestions[key] = found;
      }
    }
  }
  if (!suggestions.company)
    warnings.push("Check the insurance company; it was not clearly readable.");
  if (!suggestions.policy_number)
    warnings.push("Check the policy number; it was not clearly readable.");
  if (!suggestions.effective_from || !suggestions.effective_to)
    warnings.push("Check both policy dates against the card.");
  if (
    suggestions.effective_from &&
    suggestions.effective_to &&
    suggestions.effective_to < suggestions.effective_from
  )
    warnings.push(
      "The expiration date appears earlier than the effective date. Correct it before saving.",
    );
  const vin = raw.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] ?? null;
  return { suggestions, warnings, vin };
}
export function insuranceIdentity(p: Partial<Insurance> | null | undefined) {
  return JSON.stringify([
    p?.company?.trim().toLowerCase() ?? "",
    p?.policy_number?.trim().toLowerCase() ?? "",
    p?.effective_from ?? "",
    p?.effective_to ?? "",
  ]);
}
export type InsuranceCapture = { id: string; file: File };
export type SavedInsuranceCard = {
  id: string;
  created_at: string;
  insurance_values: Insurance;
  opportunity_id: string | null;
};
export function matchingInsuranceCard(
  cards: SavedInsuranceCard[],
  policy: Partial<Insurance> | null | undefined,
  opportunityId: string | null,
  cutoff?: string | null,
): SavedInsuranceCard | null {
  if (!policy) return null;
  return (
    cards
      .filter(
        (c) =>
          (!c.opportunity_id || c.opportunity_id === opportunityId) &&
          (!cutoff || Date.parse(c.created_at) <= Date.parse(cutoff)) &&
          insuranceIdentity(c.insurance_values) === insuranceIdentity(policy),
      )
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      )[0] ?? null
  );
}
