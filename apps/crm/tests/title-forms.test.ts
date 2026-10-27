import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PDFDocument, PDFName, PDFCheckBox, PDFTextField } from "pdf-lib";
import {
  allForms,
  titleFormTemplates,
  selectedPrintForms,
  soldPackForms,
  formValues,
  fieldKey,
  documentContext,
  type FormTemplate,
} from "../lib/documents";
import titleManifest from "../assets/forms/title-forms.json";
import { titleFormCatalog } from "../lib/title-form-catalog";
import { buildSoldPack, buildMvr2 } from "../lib/pdf-output";
import { demoWorkspace } from "../lib/demo";
import { seedOperations } from "../lib/operations-demo";
import { seedTitleClerk } from "../lib/title-clerk-demo";
const load = (f: FormTemplate) =>
  fs.readFile(new URL("../assets/forms/" + f.file, import.meta.url));
function fixture() {
  const ws = seedTitleClerk(seedOperations(demoWorkspace())),
    c = ws.title_cases![0];
  const o = ws.opportunities.find((o) => o.id === c.opportunity_id)!;
  const customer = ws.customers.find((x) => x.id === c.customer_id)!;
  return { context: documentContext(ws, customer, o), paperwork: o.paperwork };
}
test("title catalog exposes all 18 forms while leaving standard sold packets unchanged", () => {
  assert.equal(titleFormCatalog.length, 18);
  assert.equal(new Set(titleFormCatalog.map((f) => f.id)).size, 18);
  for (const item of titleFormCatalog)
    assert(allForms.some((f) => f.id === item.id));
  assert.equal(soldPackForms("without-trade").length, 12);
  assert(!soldPackForms("with-trade").some((f) => f.id === "MVR-330"));
  assert.throws(() => selectedPrintForms(["MVR-2"]));
  assert.throws(() => selectedPrintForms(["unknown"]));
  assert.deepEqual(
    selectedPrintForms(["MVR-614", "MVR-330"]).map((f) => f.id),
    ["MVR-614", "MVR-330"],
  );
});
test("official templates have canonical independent editable fields and protected signing areas", async () => {
  for (const spec of titleFormTemplates) {
    const pdf = await PDFDocument.load(await load(spec));
    const fields = pdf.getForm().getFields();
    const metadata = titleManifest.forms.find((f) => f.id === spec.id)!;
    assert.equal(pdf.getPageCount(), spec.pages.length, spec.id);
    assert.equal(
      fields.length,
      spec.pages.flatMap((p) => p.fields).length +
        metadata.excludedFields.length,
      spec.id,
    );
    for (const f of spec.pages.flatMap((p) => p.fields)) {
      const native = pdf.getForm().getField(f.name);
      assert.equal(
        native.acroField.getWidgets().length,
        1,
        `${spec.id} ${f.name}`,
      );
      assert(!metadata.excludedFields.some((e) => e.name === f.name));
      assert(f.x >= 0 && f.y >= 0 && f.width > 0 && f.height > 0);
      if (f.type === "checkbox")
        assert(native instanceof PDFCheckBox || f.textCheckbox);
      else assert(native instanceof PDFTextField);
    }
    assert.equal(metadata.source.kind, "NCDMV");
  }
});
test("special-purpose parties and certifications never inherit the sold buyer incorrectly", () => {
  const { context } = fixture();
  const ctx = {
    ...context,
    "buyer.name": "SOLD BUYER",
    "buyer.license_id": "D123",
    "buyer.license_state": "NC",
    "vehicle.vin": "1G1JC124947123456",
  };
  for (const id of ["MVR-330", "MVR-4", "MVR-5", "MVR-6", "MVR-8", "MVR-46D"]) {
    const spec = titleFormTemplates.find((f) => f.id === id)!;
    for (const field of spec.pages.flatMap((p) => p.fields))
      assert(!field.key || field.key.startsWith("vehicle."), id);
  }
  const affidavit = titleFormTemplates.find((f) => f.id === "MVR-28")!;
  assert(affidavit.pages.flatMap((p) => p.fields).every((f) => !f.key));
  const resident = titleFormTemplates.find((f) => f.id === "MVR-614")!;
  const vals = formValues(resident, ctx, {});
  assert.equal(vals.F009, "SOLD BUYER");
  assert.equal(vals.F010, "D123");
  assert.equal(vals.F011, "NC");
  assert.equal(vals.F005, "");
  assert.equal(vals.F013, "");
  for (const spec of titleFormTemplates) {
    const values = formValues(spec, ctx, {});
    for (const field of spec.pages
      .flatMap((p) => p.fields)
      .filter((f) => f.type === "checkbox"))
      assert.equal(values[fieldKey(field)], false, `${spec.id} ${field.name}`);
  }
});
test("every added form fills and flattens, preserving all pages including MVR-5 reverse", async () => {
  const { context } = fixture();
  for (const spec of titleFormTemplates) {
    const override = Object.fromEntries(
      spec.pages
        .flatMap((p) => p.fields)
        .map((f) => [
          f.name,
          f.type === "checkbox"
            ? true
            : f.key
              ? (context[f.key] ?? "")
              : "TEST",
        ]),
    );
    const bytes = await buildSoldPack(context, { [spec.id]: override }, load, [
      spec,
    ]);
    const output = await PDFDocument.load(bytes);
    assert.equal(output.getPageCount(), spec.pages.length, spec.id);
    assert.equal(output.getForm().getFields().length, 0, spec.id);
    assert(output.getPages().every((p) => !p.node.has(PDFName.of("Annots"))));
  }
});
test("MVR-2 reprint remains text-only for original preprinted stock", async () => {
  const { context } = fixture();
  for (const section of [1, 2, 3]) {
    const bytes = await buildMvr2(
      context,
      { $mvr2: { section: String(section) } },
      load,
    );
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.match(pdf.getTitle()!, /text overlay/);
    const objects = pdf.getPage(0).node.Resources()?.get(PDFName.of("XObject"));
    assert(!objects || String(objects) === "<<\n>>");
  }
});
