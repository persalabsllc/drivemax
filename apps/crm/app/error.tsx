'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="error-page"><h1>Let’s reconnect your workspace.</h1><p>Your information has not been changed. Please try loading the page again.</p><button className="btn primary" onClick={reset}>Try again</button><a className="btn" href="/login">Return to sign in</a></main>;}
