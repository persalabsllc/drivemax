import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Camera, CarFront, Check } from 'lucide-react';
import LeadForm from '../_components/LeadForm';

export const metadata: Metadata = {
  title: 'Inventory',
  description: 'Get Drive Max Used Cars inventory updates or tell us what kind of used vehicle you are shopping for in New Bern, NC.',
  alternates: { canonical: '/inventory' },
};

export default function InventoryPage() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Drive Max inventory</span>
          <h1>Inventory worth waiting for.</h1>
          <p>Drive Max is preparing to reopen. We’ll publish vehicles here only when they are actually available and ready for a closer look.</p>
          <div className="button-row">
            <a className="button button-primary" href="#vehicle-request">Tell us what you need <ArrowRight aria-hidden="true" size={18} /></a>
            <Link className="button button-ghost" href="/contact">Ask a question</Link>
          </div>
        </div>
      </section>
      <section className="page-section">
        <div className="container">
          <div className="empty-inventory-card">
            <div className="empty-inventory-icon"><CarFront aria-hidden="true" size={48} /></div>
            <div>
              <span className="availability-pill"><span className="status-dot" /> Inventory is being prepared</span>
              <h2>New listings are on the way.</h2>
              <p>Rather than show outdated or made-up inventory, this page will update as vehicles are ready for sale. Send a vehicle request below and let us know what would be a good fit.</p>
              <div className="button-row">
                <a className="button button-primary" href="#vehicle-request">Send a vehicle request</a>
                <a className="button button-secondary" href="mailto:hello@drivemaxusedcars.com">Email the dealership</a>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="page-section page-section-muted" id="vehicle-request">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Vehicle request</span>
            <h2>What are you looking for?</h2>
            <p>Give us the basics. This is not a commitment to buy—it simply helps us understand what shoppers want to see when inventory arrives.</p>
            <ul className="feature-list">
              <li><Camera aria-hidden="true" />Listings will use actual vehicle photos</li>
              <li><Check aria-hidden="true" />Price and mileage shown clearly</li>
              <li><Check aria-hidden="true" />Availability confirmed before your visit</li>
            </ul>
          </div>
          <LeadForm kind="vehicle" />
        </div>
      </section>
    </>
  );
}
