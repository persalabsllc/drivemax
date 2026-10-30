import { redirect } from "next/navigation";
import { session, workspace } from "../lib/server";
import { readIdleState } from "../lib/idle-server";
import { IDLE_TIMEOUT_MS } from "../lib/idle-policy";
import CRM from "../components/CRM";
import SessionGuard from "../components/SessionGuard";
export const dynamic = "force-dynamic";
export default async function Home() {
  const s = await session(),
    idle = await readIdleState();
  if (!s || !idle) redirect("/login");
  const initial = await workspace(s);
  return (
    <SessionGuard
      initial={{
        id: idle.id,
        expiresAt: idle.lastActiveAt + IDLE_TIMEOUT_MS,
        serverNow: Date.now(),
      }}
    >
      <CRM initial={initial} demo={false} />
    </SessionGuard>
  );
}
