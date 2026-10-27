import { createHmac, timingSafeEqual } from "node:crypto";

export function equalSecret(supplied: string, expected: string) {
  if (!expected) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validFacebookSignature(body: Buffer, signature: string, secret: string) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  return equalSecret(signature.toLowerCase(), "sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
}
export async function limitedBody(request: Request, limit = 1024 * 1024) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw Error("too_large"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
