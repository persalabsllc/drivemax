import { readFile } from "node:fs/promises";
import path from "node:path";
import { allForms } from "../../../../lib/documents";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    form = allForms.find((f) => f.id === id);
  if (!form) return new Response("Form not found", { status: 404 });
  const bytes = await readFile(
    path.join(process.cwd(), "assets", "forms", form.file),
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": `inline; filename="${form.file}"`,
    },
  });
}
