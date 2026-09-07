import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CreditCard, Mail } from 'lucide-react';

export const metadata: Metadata = { title: 'Payment Help', description: 'Payment help for existing Drive Max Used Cars customers.', alternates: { canonical: '/payments' } };

export default function PaymentsPage() {
  return <><section className="subpage-hero"><div className="container"><span className="kicker kicker-on-dark">Existing customers</span><h1>Payment help, without the guesswork.</h1><p>Online payments aren’t available through the website yet. Contact Drive Max and we’ll help with your account.</p></div></section><section className="page-section page-section-muted"><div className="container"><div className="payment-panel"><div className="payment-panel-icon"><CreditCard aria-hidden="true" size={38} /></div><h2>Need help with a payment?</h2><p>Email us with your name and the best way to reach you. We’ll follow up with the appropriate payment instructions.</p><div className="button-row"><a className="button button-primary" href="mailto:hello@drivemaxusedcars.com?subject=Drive%20Max%20payment%20help"><Mail aria-hidden="true" size={18} />Email for payment help</a><Link className="button button-secondary" href="/contact">Contact options <ArrowRight aria-hidden="true" size={18} /></Link></div></div></div></section></>;
}
