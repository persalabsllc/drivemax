"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="cr-login">
      <div className="cr-panel">
        <h1>Couldn’t load the Control Room.</h1>
        <p>
          Try again in a moment. If this continues, check the database
          connection.
        </p>
        <button className="button button-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
