import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarCheck,
  Camera,
  CarFront,
  Check,
  Mail,
  MapPin,
  MessageCircleQuestion,
  ShieldCheck,
} from 'lucide-react';

export default function Home() {
  return (
    <>
      <section className="home-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="kicker kicker-on-dark"><span className="status-dot" />Preparing to reopen in New Bern</span>
            <h1>Used cars without the <span>runaround.</span></h1>
            <p className="hero-lead">
              Drive Max is getting ready for a fresh start—with a focused selection of used vehicles and a simpler, more straightforward way to shop.
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/inventory">
                Inventory updates <ArrowRight aria-hidden="true" size={19} />
              </Link>
              <Link className="button button-ghost" href="/inventory#vehicle-request">
                Tell us what you need
              </Link>
            </div>
            <div className="hero-trust">
              <ShieldCheck aria-hidden="true" size={21} />
              <span>Real listings, clear details, and straight answers before you make the drive.</span>
            </div>
          </div>
          <div className="hero-media">
            <Image
              src="/dealership-hero.webp"
              alt="Silver crossover parked on a clean dealership lot"
              fill
              priority
              sizes="(max-width: 760px) calc(100vw - 30px), (max-width: 980px) calc(100vw - 40px), 50vw"
            />
            <div className="hero-media-shade" />
            <div className="hero-status-card">
              <span className="mini-label">Drive Max update</span>
              <strong>Reopening inventory is on the way.</strong>
              <Link href="/inventory#vehicle-request">Send a vehicle request <ArrowRight aria-hidden="true" size={16} /></Link>
            </div>
            <span className="image-caption">Illustrative image—not current inventory.</span>
          </div>
        </div>
      </section>

      <section className="quick-actions" aria-label="Popular actions">
        <div className="container quick-actions-grid">
          <Link href="/inventory#vehicle-request" className="quick-action">
            <CarFront aria-hidden="true" />
            <span><strong>Looking for a vehicle?</strong><small>Tell us make, model, budget, or body style</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/apply" className="quick-action">
            <BadgeDollarSign aria-hidden="true" />
            <span><strong>Explore financing</strong><small>Start with a basic financing inquiry</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/payments" className="quick-action">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Already a customer?</strong><small>Get help with your Drive Max account</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="section inventory-intro">
        <div className="container">
          <div className="section-heading section-heading-split">
            <div>
              <span className="kicker">Inventory</span>
              <h2>Inventory, without the filler.</h2>
            </div>
            <p>We’re not filling this site with demo cars or stale listings. Vehicles will appear as they are ready for sale, with the information you need to decide if one is worth a closer look.</p>
          </div>
          <div className="inventory-status-panel">
            <div className="inventory-icon-panel"><CarFront aria-hidden="true" size={68} /></div>
            <div className="inventory-status-copy">
              <span className="availability-pill"><span className="status-dot" /> Reopening inventory in progress</span>
              <h3>New inventory is on the way.</h3>
              <p>Tell us what you’re shopping for now. We can follow up when a vehicle matching your needs becomes available.</p>
              <Link className="text-link" href="/inventory#vehicle-request">Send a vehicle request <ArrowRight aria-hidden="true" size={17} /></Link>
            </div>
            <div className="listing-includes">
              <span>Future listings will include</span>
              <ul>
                <li><Camera aria-hidden="true" size={18} /> Actual vehicle photos</li>
                <li><Check aria-hidden="true" size={18} /> Price and mileage</li>
                <li><Check aria-hidden="true" size={18} /> VIN, stock number, and availability</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading centered-heading">
            <span className="kicker">A simpler process</span>
            <h2>From first question to final handshake.</h2>
            <p>Know what comes next, without bouncing through a dozen forms.</p>
          </div>
          <div className="steps-grid">
            <article className="step-card">
              <span className="step-number">01</span>
              <CarFront aria-hidden="true" />
              <h3>Browse real listings</h3>
              <p>See actual photos, mileage, pricing, and availability as inventory goes live.</p>
            </article>
            <article className="step-card">
              <span className="step-number">02</span>
              <MessageCircleQuestion aria-hidden="true" />
              <h3>Ask before you drive</h3>
              <p>Get answers about a vehicle, financing, or your trade before scheduling a visit.</p>
            </article>
            <article className="step-card">
              <span className="step-number">03</span>
              <CalendarCheck aria-hidden="true" />
              <h3>Plan your visit</h3>
              <p>Confirm the vehicle and a visit time so your trip to the dealership has a purpose.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section finance-feature">
        <div className="container finance-feature-grid">
          <div>
            <span className="kicker kicker-on-dark">Financing</span>
            <h2>Start with a conversation—not your Social Security number.</h2>
            <p>Send a basic financing request and we’ll help you understand the next step. Sensitive financial information does not belong in a general website form or email.</p>
            <Link className="button button-light" href="/apply">Start a financing request <ArrowRight aria-hidden="true" size={18} /></Link>
          </div>
          <ul className="finance-checklist">
            <li><Check aria-hidden="true" /> We do not ask for an SSN here</li>
            <li><Check aria-hidden="true" /> We do not request bank or card details by email</li>
            <li><Check aria-hidden="true" /> Clear next steps from a real person</li>
          </ul>
        </div>
      </section>

      <section className="section location-section">
        <div className="container location-grid">
          <div className="location-copy">
            <span className="kicker">Find Drive Max</span>
            <h2>Easy to find in New Bern.</h2>
            <p>We’re located on Old US Highway 70 West. Contact us before visiting while reopening preparations are underway.</p>
            <address>
              <MapPin aria-hidden="true" />
              <span><strong>Drive Max Used Cars LLC</strong><br />6210 Old US Hwy 70 West<br />New Bern, NC 28562</span>
            </address>
            <a className="contact-row" href="mailto:hello@drivemaxusedcars.com"><Mail aria-hidden="true" />hello@drivemaxusedcars.com</a>
            <div className="button-row">
              <a className="button button-primary" href="https://www.google.com/maps/dir/?api=1&destination=6210+Old+US+Hwy+70+West+New+Bern+NC+28562" target="_blank" rel="noreferrer">Get directions <ArrowRight aria-hidden="true" size={18} /></a>
              <Link className="button button-secondary" href="/contact">Contact us</Link>
            </div>
          </div>
          <div className="map-card">
            <iframe
              title="Map showing Drive Max Used Cars in New Bern"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src="https://www.google.com/maps?q=6210%20Old%20US%20Hwy%2070%20West%20New%20Bern%20NC%2028562&output=embed"
            />
          </div>
        </div>
      </section>
    </>
  );
}
