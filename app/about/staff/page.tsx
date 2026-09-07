import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, UsersRound } from 'lucide-react';

export const metadata: Metadata = { title: 'Meet the Team', description: 'Meet the people behind Drive Max Used Cars in New Bern, North Carolina.', alternates: { canonical: '/about/staff' } };

export default function StaffPage() {
  return <><section className="subpage-hero"><div className="container"><span className="kicker kicker-on-dark">The Drive Max team</span><h1>People you can actually reach.</h1><p>Team profiles and direct contact information will be added as reopening preparations are completed.</p></div></section><section className="page-section page-section-muted"><div className="container"><div className="payment-panel"><div className="payment-panel-icon"><UsersRound aria-hidden="true" size={38} /></div><h2>We’re putting the team together.</h2><p>We won’t fill this page with generic staff photos or made-up bios. Check back for the real people, roles, and contact information behind Drive Max.</p><div className="button-row"><Link className="button button-primary" href="/contact">Contact the dealership <ArrowRight aria-hidden="true" size={18} /></Link><Link className="button button-secondary" href="/about/employment">Employment interest</Link></div></div></div></section></>;
}
