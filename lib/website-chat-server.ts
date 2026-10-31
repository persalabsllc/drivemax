import "server-only";
import { createHash } from "node:crypto";
import { db } from "./backend";
export const CHAT_ORG = "d5a1c100-0000-4000-8000-000000000001";
export const CHAT_COOKIE = "dm_website_chat";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export type ChatCredential = { id: string; hash: string };
export function readChatCredential(
  raw: string | undefined,
): ChatCredential | null {
  const m = raw?.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);
  return m &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(m[1])
    ? { id: m[1], hash: tokenHash(m[2]) }
    : null;
}
export async function chatRPC(
  session: ChatCredential,
  action: string,
  data: Record<string, unknown> = {},
) {
  const { data: value, error } = await db().rpc("dmcrm_chat_public", {
    p_org: CHAT_ORG,
    p_id: session.id,
    p_token: session.hash,
    p_action: action,
    p_data: data,
  });
  if (error)
    throw Object.assign(new Error(error.message), { code: error.code });
  return value;
}
