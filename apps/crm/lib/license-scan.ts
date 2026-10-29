import { z } from "zod";
import type { Person } from "./people";

// AAMVA Annex D field definitions and issuer directory:
// https://www.aamva.org/getmedia/81af105d-8b1b-45e1-aa46-f1800a259ed1/AAMVADLIDCardDesignStandard2025.pdf
// https://www.aamva.org/identity/issuer-identification-numbers-(iin)
// Issuing jurisdiction is separate from the address state (e.g. military residents).
const jurisdictions: Record<string, string> = Object.fromEntries(
  "636000:VA 636001:NY 636002:MA 636003:MD 636004:NC 636005:SC 636006:CT 636007:LA 636008:MT 636009:NM 636010:FL 636011:DE 636012:ON 636013:NS 636014:CA 636015:TX 636016:NL 636017:NB 636018:IA 636019:GU 636020:CO 636021:AR 636022:KS 636023:OH 636024:VT 636025:PA 636026:AZ 636028:BC 636029:OR 636030:MO 636031:WI 636032:MI 636033:AL 636034:ND 636035:IL 636036:NJ 636037:IN 636038:MN 636039:NH 636040:UT 636041:ME 636042:SD 636043:DC 636044:SK 636045:WA 636046:KY 636047:HI 636048:MB 636049:NV 636050:ID 636051:MS 636052:RI 636053:TN 636054:NE 636055:GA 636058:OK 636059:AK 636060:WY 636061:WV 636062:VI 604426:PE 604427:AS 604428:QC 604429:YT 604430:MP 604431:PR 604432:AB 604433:NU 604434:NT"
    .split(" ")
    .map((entry) => entry.split(":")),
);
const canadian = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);
export type LicenseDetails = {
  person: Pick<
    Person,
    | "first_name"
    | "middle_name"
    | "last_name"
    | "suffix"
    | "address1"
    | "address2"
    | "city"
    | "state"
    | "zip"
    | "license_state"
    | "license_number"
  >;
  birthday: string;
  warnings: string[];
};
function dateValue(value: string, yearFirst: boolean) {
  if (!/^\d{8}$/.test(value)) return null;
  const iso = yearFirst
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : `${value.slice(4)}-${value.slice(0, 2)}-${value.slice(2, 4)}`;
  return z.iso.date().safeParse(iso).success ? iso : null;
}
/** Only field-delimited AAMVA data is accepted. Never guess fields in arbitrary QR text. */
export function parseLicenseBarcode(input: string): LicenseDetails | null {
  if (input.length > 16000) return null;
  const raw = input.replace(/^\]L\d/, "");
  const header =
    /^@[\n\r\x1e ]{1,6}(?:ANSI |AAMVA)(\d{6})(\d{2})(\d{2})(\d{2})/.exec(raw);
  if (!header) return null;
  const entries = Number(header[4]);
  if (entries < 1 || entries > 20) return null;
  let body: string | null = null;
  for (let i = 0; i < entries; i++) {
    const descriptor = raw.slice(
      header[0].length + i * 10,
      header[0].length + (i + 1) * 10,
    );
    if (!/^(DL|ID)\d{8}$/.test(descriptor)) continue;
    const offset = Number(descriptor.slice(2, 6)),
      length = Number(descriptor.slice(6));
    const section = raw.slice(offset, offset + length);
    if (
      section.startsWith(descriptor.slice(0, 2)) &&
      offset + length <= raw.length
    )
      body = section.slice(2);
  }
  // Some older issuers count CR/LF differently. Still require the full header,
  // descriptor table, an explicit DL/ID subfile and real field delimiters.
  if (body === null) {
    const section = raw.slice(header[0].length + entries * 10);
    if (/^(DL|ID)D[A-Z]{2}/.test(section))
      body = section.slice(2).split("\r")[0];
  }
  if (!body) return null;
  const fields = new Map<string, string>();
  for (const line of body.split(/[\n\r\x1e]/)) {
    const field = /^(D[A-Z]{2})([^\x00-\x1f]*)$/.exec(line);
    if (!field) continue;
    if (fields.has(field[1]) && fields.get(field[1]) !== field[2].trim())
      return null;
    fields.set(field[1], field[2].trim());
  }
  const get = (code: string) => fields.get(code) ?? "";
  const legacyName = get("DAA")
    .split(",")
    .map((s) => s.trim());
  const first = get("DAC") || get("DCT") || legacyName[1] || "";
  const last = get("DCS") || get("DAB") || legacyName[0] || "";
  const issuer = jurisdictions[header[1]] ?? "";
  const birthday = dateValue(
    get("DBB"),
    get("DCG") === "CAN" || canadian.has(issuer) || Number(header[2]) <= 1,
  );
  if (
    !first ||
    !last ||
    !get("DAQ") ||
    !birthday ||
    birthday > new Date().toISOString().slice(0, 10) ||
    birthday < "1900-01-01"
  )
    return null;
  let zip = get("DAK").replace(/\s+$/, "");
  if (/^\d{9}$/.test(zip))
    zip = zip.endsWith("0000")
      ? zip.slice(0, 5)
      : `${zip.slice(0, 5)}-${zip.slice(5)}`;
  const warnings: string[] = [];
  if (["DDE", "DDF", "DDG"].some((key) => get(key) === "T"))
    warnings.push(
      "A name was shortened on the barcode. Check the full printed name.",
    );
  if (!issuer) warnings.push("Confirm the license's issuing state.");
  if (!["DAG", "DAI", "DAJ", "DAK"].every((key) => get(key)))
    warnings.push("Complete any missing address fields.");
  const expires = dateValue(
    get("DBA"),
    get("DCG") === "CAN" || canadian.has(issuer) || Number(header[2]) <= 1,
  );
  if (expires && expires < new Date().toISOString().slice(0, 10))
    warnings.push(
      "This license appears expired. Review the current license before proceeding.",
    );
  const person = {
    first_name: first,
    last_name: last,
    middle_name: (get("DAD") || legacyName[2] || "")
      .replace(/,/g, " ")
      .replace(/^NONE$/i, ""),
    suffix: /^JR\.?$/i.test(get("DCU"))
      ? "Jr."
      : /^SR\.?$/i.test(get("DCU"))
        ? "Sr."
        : get("DCU"),
    address1: get("DAG"),
    address2: get("DAH"),
    city: get("DAI"),
    state: get("DAJ"),
    zip,
    license_state: issuer,
    license_number: get("DAQ"),
  };
  if (
    Object.values(person).some((value) => value.length > 250) ||
    person.license_number.length > 40 ||
    person.state.length > 2 ||
    zip.length > 15
  )
    return null;
  return { person, birthday, warnings };
}
export const licenseCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.03).max(1),
    height: z.number().min(0.03).max(1),
  })
  .refine(
    (v) => v.x + v.width <= 1.000001 && v.y + v.height <= 1.000001,
    "Keep the profile photo inside the license.",
  );
export type LicenseCrop = z.infer<typeof licenseCropSchema>;
export type LicenseCapture = { id: string; file: File; crop: LicenseCrop };
export type SavedLicense = {
  id: string;
  license_portrait: LicenseCrop;
  created_at: string;
};
export const MAX_LICENSE_BYTES = 3 * 1024 * 1024;
