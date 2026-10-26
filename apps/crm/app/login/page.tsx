import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { session } from "../../lib/server";
import Login from "./Login";
export const metadata: Metadata = { title: "Staff sign-in | Drive Max CRM" };
export default async function LoginPage() {
  if (await session()) redirect("/");
  return <Login />;
}
