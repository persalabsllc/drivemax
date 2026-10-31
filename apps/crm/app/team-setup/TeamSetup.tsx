"use client";
import { roleLabel } from "../../lib/permissions";
import { useEffect, useState } from "react";
export default function TeamSetup() {
  const [token, setToken] = useState(""),
    [staff, setStaff] = useState<{
      name: string;
      email: string;
      role: string;
    } | null>(null),
    [mode, setMode] = useState<"new" | "existing">("new"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = window.location.hash.slice(1);
    setToken(value);
    if (!value) {
      setError("Open the setup link your manager shared with you.");
      return;
    }
    fetch("/api/team-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: value }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        setStaff(data);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="team-setup-page">
      <section className="team-setup-card">
        <img src="/drive-max-logo.webp" alt="Drive Max" />
        <span className="eyebrow">YOUR DEALERSHIP WORKSPACE</span>
        <h1>{staff ? `Welcome, ${staff.name}.` : "Set up your account"}</h1>
        {staff && (
          <>
            <p>
              Your role is {roleLabel(staff.role)}. Your assigned follow-ups
              will be waiting in your planner.
            </p>
            <div className="segmented">
              <button
                onClick={() => setMode("new")}
                className={mode === "new" ? "chosen" : ""}
              >
                New account
              </button>
              <button
                onClick={() => setMode("existing")}
                className={mode === "existing" ? "chosen" : ""}
              >
                Existing account
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const f = new FormData(e.currentTarget);
                  const r = await fetch("/api/team-setup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      token,
                      mode,
                      password: f.get("password"),
                    }),
                  });
                  const data = await r.json();
                  if (!r.ok) throw Error(data.error);
                  window.location.replace(data.redirect);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to finish setup.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="username"
                  value={staff.email}
                  readOnly
                />
              </label>
              <label>
                {mode === "new"
                  ? "Choose a password (12 characters minimum)"
                  : "Your existing password"}
                <input
                  key={mode}
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "new" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode === "new" ? 12 : 1}
                  maxLength={128}
                />
              </label>
              <button className="btn primary" disabled={busy}>
                {busy ? "Setting up…" : "Join your workspace"}
              </button>
            </form>
          </>
        )}
        {!staff && !error && <p>Checking your setup link…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <a href="/login" className="text-btn">
          Back to sign in
        </a>
      </section>
    </main>
  );
}
