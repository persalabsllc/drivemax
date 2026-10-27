"use client";
import { useState } from "react";
export function Unsubscribe({ token }: { token: string }) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="public-appointment">
      <img src="/drive-max-logo.webp" alt="Drive Max Used Cars" />
      <h1>Email preferences</h1>
      <p>
        {done
          ? "You have been unsubscribed from Drive Max CRM emails."
          : "You can stop follow-up and appointment emails from Drive Max. Call (252) 541-0040 if you need help with a visit or purchase."}
      </p>
      {!done && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch(`/api/email-preferences/${token}`, {
                method: "POST",
              });
              const data = await r.json();
              if (!r.ok) throw Error(data.error);
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Unsubscribe from email
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
