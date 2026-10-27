"use client";
import { useState } from "react";
import { appointmentTime, appointmentKinds } from "../lib/appointments";
type AppointmentInfo = {
  starts_at: string;
  duration_minutes: number;
  kind: keyof typeof appointmentKinds;
  status: string;
  request_received: boolean;
};
export function PublicAppointment({
  token,
  initial,
}: {
  token: string;
  initial: AppointmentInfo | null;
}) {
  const [data, setData] = useState(initial),
    [request, setRequest] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function act(action: "confirm" | "request") {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/appointment/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, request }),
      });
      const out = await r.json();
      if (!r.ok) throw Error(out.error);
      setData(out);
      setMessage(
        action === "confirm"
          ? "Thank you—your appointment is confirmed."
          : "We received your request. Our team will contact you to confirm a new time.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-appointment">
      <img src="/drive-max-logo.webp" alt="Drive Max Used Cars" />
      <h1>
        {data ? "Your Drive Max appointment" : "Appointment link unavailable"}
      </h1>
      {data ? (
        <>
          <p>
            <strong>{appointmentKinds[data.kind]}</strong>
            <br />
            {appointmentTime(data.starts_at)}
            <br />
            {new Date(data.starts_at).toLocaleDateString("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            <br />
            {data.duration_minutes} minutes · {data.status.replaceAll("_", " ")}
          </p>
          <p>
            6210 Old US Hwy 70 W<br />
            New Bern, NC 28562
          </p>
          {["scheduled", "confirmed"].includes(data.status) &&
            new Date(data.starts_at) > new Date() && (
              <div className="ops-actions">
                <button
                  className="btn primary"
                  disabled={busy || data.status === "confirmed"}
                  onClick={() => act("confirm")}
                >
                  {data.status === "confirmed"
                    ? "Confirmed"
                    : "Confirm appointment"}
                </button>
                <a className="btn" href={`/api/appointment/${token}`}>
                  Add to calendar
                </a>
              </div>
            )}
          {!["arrived", "completed"].includes(data.status) && (
            <>
              <label>
                Need a different time?
                <textarea
                  maxLength={1000}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="Tell us which day and time work for you."
                />
              </label>
              <div className="ops-actions">
                <button
                  className="btn"
                  disabled={busy || !request.trim()}
                  onClick={() => act("request")}
                >
                  Request another time
                </button>
              </div>
              {data.request_received && (
                <p>
                  Our team has received your request. A new time is booked only
                  after we confirm it with you.
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <p>
          This link may have been replaced when your appointment changed. Please
          use the latest email or call us.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        Questions? <a href="tel:+12525410040">(252) 541-0040</a>
      </p>
    </main>
  );
}
