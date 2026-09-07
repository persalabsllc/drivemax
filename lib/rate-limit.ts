import "server-only";
import { createHmac } from "node:crypto";
import { db } from "./backend";
export async function takeSlot(identity: string, scope: string, max: number) {
  if (!process.env.LEAD_RATE_LIMIT_SECRET)
    throw new Error("Submission service is not configured.");
  const hash = createHmac("sha256", process.env.LEAD_RATE_LIMIT_SECRET)
    .update(identity)
    .digest("hex");
  const bucket = `${scope}:${Math.floor(Date.now() / 3600000)}:${hash}`;
  const { data, error } = await db().rpc("take_request_slot", {
    bucket_key: bucket,
    maximum: max,
  });
  if (error) throw new Error("Submission service is temporarily unavailable.");
  return data === true;
}
