"use client";
import { useActionState, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  LayoutDashboard,
  Users,
  CalendarDays,
  Eye,
  EyeOff,
} from "lucide-react";
import { signIn } from "./actions";

export default function Login() {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="login-page">
      <section className="login-story">
        <a className="login-logo" href="/login">
          <img src="/drive-max-logo.webp" alt="Drive Max Used Cars" />
        </a>
        <div className="login-pitch">
          <span className="eyebrow">DRIVE MAX · DEALERSHIP WORKSPACE</span>
          <h1>
            Your dealership.
            <br />
            <em>Ready for the day.</em>
          </h1>
          <p>
            Customers, appointments and deals.
            <br />
            Everything your team needs to keep moving.
          </p>
          <div className="login-features">
            <span>
              <Users size={19} />
              Customers and follow-up.
            </span>
            <span>
              <LayoutDashboard size={19} />
              Inventory, desking and F&I.
            </span>
            <span>
              <CalendarDays size={19} />
              Appointments and daily tasks.
            </span>
          </div>
        </div>
        <div className="login-bottom">
          DRIVE MAX CRM <span>Drive Max Used Cars · New Bern, NC</span>
        </div>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="login-badge">
            <ShieldCheck size={17} />
            STAFF SIGN-IN
          </span>
          <h2>Welcome back.</h2>
          <p>Sign in to start your sales day.</p>
          <form
            action={action}
            aria-describedby={state.error ? "sign-in-error" : undefined}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@drivemaxusedcars.com"
                required
              />
            </label>
            <label htmlFor="crm-password">Password</label>
            <div className="login-password">
              <input
                id="crm-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {state.error && (
              <p className="form-error" id="sign-in-error" role="alert">
                {state.error}
              </p>
            )}
            <button className="btn primary" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-help">
            Use your existing CRM email and password. New team members can use
            the setup link shared by their manager.
          </p>
        </div>
      </section>
    </main>
  );
}
