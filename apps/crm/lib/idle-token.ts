import { createHmac, timingSafeEqual } from "node:crypto";
import { IDLE_TIMEOUT_MS, type IdleState } from "./idle-policy";
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`drive-max-idle-v1:${payload}`)
    .digest();
}
export function signIdleState(state: IdleState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function verifyIdleState(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): IdleState | null {
  if (!token || !secret || token.length > 1024) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, supplied] = parts;
    const actual = Buffer.from(supplied, "base64url"),
      expected = signature(payload, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      typeof state.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(state.id) ||
      typeof state.userId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(state.userId) ||
      !Number.isSafeInteger(state.lastActiveAt) ||
      state.lastActiveAt > now ||
      now - state.lastActiveAt >= IDLE_TIMEOUT_MS
    )
      return null;
    return state;
  } catch {
    return null;
  }
}
