import type { Metadata } from 'next';
import { Check, LockKeyhole, MessageSquareText, ShieldCheck } from 'lucide-react';
import LeadForm from '../_components/LeadForm';

export const metadata: Metadata = { title: 'Financing', description: 'Start a basic financing request with Drive Max Used Cars in New Bern, NC without sharing sensitive financial information.', alternates: { canonical: '/apply' } };

export default function FinancingPage() {
  return (
    <>
      <section className="subpage-hero"><div className="container"><span className="kicker kicker-on-dark">Explore financing</span><h1>Start with the basics. Keep sensitive information secure.</h1><p>This short request begins a conversation about vehicle financing. It is not a credit application and does not ask for a Social Security number.</p></div></section>
      <section className="page-section page-section-muted">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Financing request</span><h2>Tell us how to reach you.</h2><p>We’ll use the information here to understand what you’re shopping for and explain the appropriate next step.</p>
            <ul className="feature-list"><li><Check aria-hidden="true" />No Social Security number requested</li><li><Check aria-hidden="true" />No date of birth or bank information</li><li><Check aria-hidden="true" />No promise or guarantee of approval</li></ul>
            <div className="security-note"><LockKeyhole aria-hidden="true" size={22} /><span>Do not type a Social Security number, birth date, driver’s license number, bank account, or card number into this form or any email.</span></div>
          </div>
          <LeadForm kind="finance" />
        </div>
      </section>
      <section className="section">
        <div className="container"><div className="section-heading centered-heading"><span className="kicker">What happens next</span><h2>A clear, three-step start.</h2></div>
          <div className="steps-grid">
            <article className="step-card"><span className="step-number">01</span><MessageSquareText aria-hidden="true" /><h3>Send your request</h3><p>Share basic contact information and what kind of vehicle you have in mind.</p></article>
            <article className="step-card"><span className="step-number">02</span><ShieldCheck aria-hidden="true" /><h3>Review your options</h3><p>Drive Max will explain available next steps without asking for sensitive data by email.</p></article>
            <article className="step-card"><span className="step-number">03</span><LockKeyhole aria-hidden="true" /><h3>Apply securely</h3><p>If an application is appropriate, use only the verified secure process provided directly by Drive Max.</p></article>
          </div>
        </div>
      </section>
    </>
  );
}
