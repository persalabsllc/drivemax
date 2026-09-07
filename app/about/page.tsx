import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata: Metadata = { title: 'About', description: 'Learn about Drive Max Used Cars, a local used-car dealership preparing to reopen in New Bern, North Carolina.', alternates: { canonical: '/about' } };

export default function AboutPage() {
  return (
    <>
      <section className="subpage-hero"><div className="container"><span className="kicker kicker-on-dark">About Drive Max</span><h1>A familiar local name, getting ready for a fresh start.</h1><p>Drive Max Used Cars first opened in New Bern in 2019. Now we’re preparing the dealership for its next chapter on Old US Highway 70 West.</p></div></section>
      <section className="section">
        <div className="container story-grid">
          <div className="story-copy"><span className="kicker">Our approach</span><h2>Make the important parts easier to understand.</h2><p>A used car is a major purchase. Shoppers should be able to see what is actually available, get the important details, ask honest questions, and understand the next step before spending half a day at a dealership.</p><p>That is the standard we are building toward as Drive Max prepares to reopen: useful information, a direct line to the dealership, and no pretend inventory just to make the website look full.</p><div className="button-row"><Link className="button button-primary" href="/inventory">See inventory updates <ArrowRight aria-hidden="true" size={18} /></Link><Link className="button button-secondary" href="/contact">Contact Drive Max</Link></div></div>
          <aside className="story-highlight"><span>Drive Max Used Cars LLC</span><strong>Locally operated in New Bern, North Carolina.</strong><p>6210 Old US Hwy 70 West<br />New Bern, NC 28562</p></aside>
        </div>
      </section>
      <section className="section section-muted"><div className="container"><div className="section-heading"><span className="kicker">What matters here</span><h2>Built around the way people actually shop.</h2></div><div className="values-grid"><article className="value-card"><span>01</span><h3>Real availability</h3><p>Vehicles appear online when they are ready to be shown—not as placeholders or stale listings.</p></article><article className="value-card"><span>02</span><h3>Useful answers</h3><p>Ask about condition, pricing, financing, or timing before planning a trip to the dealership.</p></article><article className="value-card"><span>03</span><h3>A straightforward process</h3><p>Clear information, helpful communication, and fewer hoops between your first question and the right vehicle.</p></article></div></div></section>
    </>
  );
}
