"use client";
import { useActionState } from "react";
import { loginAction, type ActionResult } from "../actions";
export default function LoginForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    loginAction,
    {},
  );
  return (
    <form action={action} className="cr-form">
      <label>
        Staff email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </label>
      <button className="button button-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p
        className={state.error ? "cr-error" : "cr-muted"}
        role={state.error ? "alert" : "status"}
      >
        {state.error || state.message}
      </p>
    </form>
  );
}
