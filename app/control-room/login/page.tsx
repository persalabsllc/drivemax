import Link from "next/link";
import { redirect } from "next/navigation";
import { backendReady, staffSession } from "../../../lib/backend";
import LoginForm from "./LoginForm";
export const dynamic = "force-dynamic";
export default async function Login() {
  if (await staffSession()) redirect("/control-room");
  return (
    <section className="cr-login">
      <div className="cr-panel">
        <span className="kicker">Drive Max · Staff access</span>
        <h1>
          Your dealership.
          <br />
          One Control Room.
        </h1>
        <p className="cr-muted">
          Inventory, customer conversations, and the next follow-up.
        </p>
        {backendReady() ? (
          <LoginForm />
        ) : (
          <div className="cr-setup">
            <h2>Activation in progress</h2>
            <p>
              The Control Room is not open for sign-in yet. Database, staff
              access, and email setup must be completed first.
            </p>
          </div>
        )}
        <Link href="/" className="text-link">
          ← Back to the website
        </Link>
      </div>
    </section>
  );
}
