import { z } from "zod";
import { db } from "../../../lib/server";
import { PublicAppointment } from "../../../components/PublicAppointment";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your Drive Max appointment",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let appointment = null;
  if (z.uuid().safeParse(token).success) {
    try {
      const r = await db().rpc("dmcrm_public_appointment", { p_token: token });
      appointment = r.error ? null : r.data;
    } catch {}
  }
  return <PublicAppointment token={token} initial={appointment} />;
}
