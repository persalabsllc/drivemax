import manifest from "../assets/forms/manifest.json";
import titleManifest from "../assets/forms/title-forms.json";
import type { FormTemplate, Paperwork } from "./documents";

const forms = [
  ...manifest.forms,
  manifest.mvr2,
  ...titleManifest.forms,
] as FormTemplate[];
export const coBuyerPaperworkFields: Record<string, string[]> =
  Object.fromEntries(
    forms.flatMap((form) => {
      const fields = form.pages.flatMap((p) => p.fields);
      const related = (f: (typeof fields)[number], trade = false) =>
        f.key?.startsWith("co_buyer.") ||
        (!trade &&
          (f.key === "buyers.names" ||
            f.name.endsWith("buyer_name_address"))) ||
        /co_?buyer.*signature/i.test(f.name);
      const keys = (trade = false) =>
        fields
          .filter((f) => related(f, trade))
          .map((f) => (f.radioGroup ? `${f.name}::${f.exportValue}` : f.name));
      return [
        [form.id, keys()],
        ...(["MVR-180", "MVR-181", "MVR-63"].includes(form.id)
          ? [[`trade-${form.id}`, keys(true)]]
          : []),
      ];
    }),
  );

export function clearCoBuyerPaperwork(paperwork: Paperwork = {}): Paperwork {
  return Object.fromEntries(
    Object.entries(paperwork).map(([form, values]) => [
      form,
      Object.fromEntries(
        Object.entries(values).filter(([key]) =>
          form === "$common"
            ? !key.startsWith("co_buyer.") && key !== "buyers.names"
            : !(coBuyerPaperworkFields[form] ?? []).includes(key),
        ),
      ),
    ]),
  );
}
