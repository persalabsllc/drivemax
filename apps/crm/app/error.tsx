"use client";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="error-page">
      <h1>Let’s reconnect your workspace.</h1>
      <p>Your information has not been changed. Please try loading the page again.</p>
      <button className="btn primary" onClick={() => retry()}>Try again</button>
      <a className="btn" href="/login?recover=1">Return to sign in</a>
    </main>
  );
}
