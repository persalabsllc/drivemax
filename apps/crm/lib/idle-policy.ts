export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;
export const ACTIVITY_SYNC_MS = 15 * 1000;
export const IDLE_COOKIE = "dmcrm-idle";
export type IdleState = { id: string; userId: string; lastActiveAt: number };
export type IdleClientState = {
  id: string;
  expiresAt: number;
  serverNow: number;
};
export function idleRemaining(lastActiveAt: number, now: number) {
  return Math.max(0, lastActiveAt + IDLE_TIMEOUT_MS - now);
}
// Activity can only be backdated, never extended into the future.
export function activityTime(previous: number, idleForMs: number, now: number) {
  if (
    !Number.isFinite(idleForMs) ||
    idleForMs < 0 ||
    idleForMs >= IDLE_TIMEOUT_MS
  )
    return null;
  return Math.max(previous, now - Math.ceil(idleForMs));
}
