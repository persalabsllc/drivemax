import Link from 'next/link';

export default function NotFound() {
  return <section className="not-found"><div className="container not-found-card"><strong>404</strong><h1>That page took a wrong turn.</h1><p>The link may be outdated, but the rest of Drive Max is right where you left it.</p><div className="button-row"><Link className="button button-primary" href="/">Go to the homepage</Link><Link className="button button-secondary" href="/inventory">Check inventory</Link></div></div></section>;
}
