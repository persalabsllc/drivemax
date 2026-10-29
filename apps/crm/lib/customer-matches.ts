import { z } from "zod";
import type { Workspace } from "./model";

export const matchInputSchema = z.object({
  phone: z.string().max(30),
  email: z.string().max(250),
  license_number: z.string().max(40),
  license_state: z.string().max(2),
});
export type MatchInput = z.infer<typeof matchInputSchema>;
export type CustomerMatch = {
  id: string;
  name: string;
  phone: string;
  email: string;
  reasons: string[];
};
export const duplicateError =
  "Possible duplicate customers found. Review the matches before creating a separate profile.";
export const matchPhone = (v: string) => {
  const n = v.replace(/\D/g, "");
  return n.length === 11 && n.startsWith("1")
    ? n.slice(1)
    : n.length === 10
      ? n
      : "";
};
const licenseKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function demoCustomerMatches(
  ws: Workspace,
  input: MatchInput,
): CustomerMatch[] {
  const phone = matchPhone(input.phone),
    email = input.email.trim().toLowerCase(),
    license = licenseKey(input.license_number);
  return ws.customers
    .filter((c) => !c.merged_into)
    .flatMap((c) => {
      const contacts = [
        c,
        ...(ws.customer_aliases ?? []).filter((a) => a.customer_id === c.id),
      ];
      const reasons: string[] = [];
      if (phone && contacts.some((p) => matchPhone(p.phone) === phone))
        reasons.push("Phone");
      if (
        email.includes("@") &&
        contacts.some((p) => p.email.trim().toLowerCase() === email)
      )
        reasons.push("Email");
      if (
        license.length >= 4 &&
        input.license_state &&
        licenseKey(c.person?.license_number ?? "") === license &&
        c.person?.license_state.toUpperCase() ===
          input.license_state.toUpperCase()
      )
        reasons.push("Driver license");
      return reasons.length
        ? [{ id: c.id, name: c.name, phone: c.phone, email: c.email, reasons }]
        : [];
    })
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length || a.name.localeCompare(b.name),
    )
    .slice(0, 25);
}
export async function findCustomerMatches(
  ws: Workspace,
  input: MatchInput,
  demo: boolean,
  signal?: AbortSignal,
): Promise<CustomerMatch[]> {
  if (demo) return demoCustomerMatches(ws, input);
  const r = await fetch("/api/customer-matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.error || "Customer matches could not be checked. Please retry.",
    );
  return data.matches;
}
