import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { session } from "../../lib/server";
import Login from "./Login";
export const metadata: Metadata = { title: "Staff sign-in | Drive Max CRM" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{recover?: string}> }) {
  // Recovery must display sign-in even when a valid session's workspace fails.
  // This is read-only: submitting the form replaces the existing session normally.
  const {recover} = await searchParams;
  if (recover !== "1" && await session()) redirect("/");
  return <Login />;
}
