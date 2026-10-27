import {
  documentMime,
  MAX_DOCUMENT_SIZE,
  type DocumentMetadata,
} from "./vault-documents";
export class PendingDocumentError extends Error {
  constructor(
    public id: string,
    message: string,
  ) {
    super(message);
  }
}
async function request(body: unknown) {
  const r = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error || "The document could not be filed.");
  return v;
}
export async function completeDocument(id: string) {
  return request({ action: "complete", id });
}
export async function uploadDocument(
  file: File,
  metadata: DocumentMetadata,
  onStage: (value: string) => void = () => {},
) {
  if (!file.size || file.size > MAX_DOCUMENT_SIZE)
    throw Error("Choose a file up to 25 MB.");
  const mime = documentMime(
    new Uint8Array(await file.slice(0, 8).arrayBuffer()),
  );
  if (!mime) throw Error("Only PDF, JPG and PNG documents are supported.");
  onStage("Preparing…");
  const prepared = await request({
    ...metadata,
    action: "prepare",
    name: file.name.slice(0, 200),
    size: file.size,
    mime,
  });
  onStage("Uploading…");
  // The short-lived URL grants permission only to this new, non-overwritable object.
  const uploaded = await fetch(prepared.url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-upsert": "false",
      "cache-control": "max-age=0",
    },
    body: file,
  });
  if (!uploaded.ok) throw Error("The upload did not finish. Please try again.");
  onStage("Verifying & filing…");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await completeDocument(prepared.id);
    } catch (e) {
      last = e instanceof Error ? e.message : "Please retry filing.";
    }
  }
  throw new PendingDocumentError(prepared.id, last);
}
