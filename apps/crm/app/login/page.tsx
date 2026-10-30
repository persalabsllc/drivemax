import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { session } from "../../lib/server";
import Login from "./Login";
export const metadata: Metadata = { title: "Staff sign-in | Drive Max CRM" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ recover?: string; reason?: string }>;
}) {
  const { recover, reason } = await searchParams;
  if (recover !== "1" && (await session())) redirect("/");
  return <Login timedOut={reason === "inactive"} />;
}
