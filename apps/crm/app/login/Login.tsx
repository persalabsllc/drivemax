"use client";
import { useActionState, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  LockKeyhole,
  Eye,
  EyeOff,
} from "lucide-react";
import { signIn } from "./actions";

export default function Login({ timedOut = false }: { timedOut?: boolean }) {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="signin-page">
      <div className="signin-art" aria-hidden="true">
        <div className="signin-orbit signin-orbit-red" />
        <div className="signin-orbit signin-orbit-blue" />
        <div className="signin-streak signin-streak-one" />
        <div className="signin-streak signin-streak-two" />
      </div>
      <div className="signin-shell">
        <a
          className="signin-brand"
          href="/login"
          aria-label="Drive Max CRM sign in"
        >
          <img
            src="/drive-max-logo.webp"
            alt="Drive Max Used Cars"
            width="206"
            height="88"
          />
          <span>
            CRM <i /> STAFF ACCESS
          </span>
        </a>
        <section className="signin-card" aria-labelledby="signin-heading">
          <div className="signin-accent" aria-hidden="true" />
          <div className="signin-lock" aria-hidden="true">
            <LockKeyhole size={23} />
          </div>
          <h1 id="signin-heading">
            Welcome back<span>.</span>
          </h1>
          <p className="signin-intro">Sign in to Drive Max.</p>
          {timedOut && (
            <p className="signin-notice" role="status">
              You were signed out after 30 minutes of inactivity. Sign in to
              continue.
            </p>
          )}
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
                inputMode="email"
                required
              />
            </label>
            <label htmlFor="crm-password">Password</label>
            <div className="signin-password">
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
                className="signin-reveal"
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
            <button className="signin-submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="signin-help">Need access? Contact your manager.</p>
          <div className="signin-security">
            <ShieldCheck size={14} />
            <span>Automatic sign-out after 30 minutes idle</span>
          </div>
        </section>
        <footer className="signin-footer">
          <span>DRIVE MAX</span>
          <i />
          New Bern, North Carolina
        </footer>
      </div>
    </main>
  );
}
