import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CreditCard, LockKeyhole, Mail } from 'lucide-react';

export const metadata: Metadata = { title: 'Payment Help', description: 'Payment help for existing Drive Max Used Cars customers.', alternates: { canonical: '/payments' } };

export default function PaymentsPage() {
  return <><section className="subpage-hero"><div className="container"><span className="kicker kicker-on-dark">Existing customers</span><h1>Payment help, without the guesswork.</h1><p>Online payment is not available through this site. Please contact Drive Max directly for the correct next step.</p></div></section><section className="page-section page-section-muted"><div className="container"><div className="payment-panel"><div className="payment-panel-icon"><CreditCard aria-hidden="true" size={38} /></div><h2>Contact us for payment instructions.</h2><p>Do not enter payment information into a general form or send card or banking details by email. Use only instructions you have verified directly with the dealership.</p><div className="security-note payment-security-note"><LockKeyhole aria-hidden="true" size={22} /><span>Avoid payment links received from unknown senders. Confirm the payment method and destination with Drive Max before sending funds.</span></div><div className="button-row"><a className="button button-primary" href="mailto:hello@drivemaxusedcars.com?subject=Drive%20Max%20payment%20help"><Mail aria-hidden="true" size={18} />Email for payment help</a><Link className="button button-secondary" href="/contact">Contact options <ArrowRight aria-hidden="true" size={18} /></Link></div></div></div></section></>;
}
