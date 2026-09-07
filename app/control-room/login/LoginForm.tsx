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
        Sign-in code{" "}
        <span className="cr-muted">(leave blank to request one)</span>
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6,10}"
          autoComplete="one-time-code"
          maxLength={10}
        />
      </label>
      <button className="button button-primary" disabled={pending}>
        {pending ? "Signing in…" : "Continue"}
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
