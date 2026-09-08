import Image from "next/image";
import Link from "next/link";
import FeaturedInventory from "./_components/FeaturedInventory";
import HomepageInventory from "./_components/HomepageInventory";
import { photoUrl, publicInventory } from "../lib/backend";
import { featuredHomepageVehicles } from "../lib/homepage-inventory";
import {
  ArrowRight,
  BadgeCheck,
  BadgeDollarSign,
  CalendarCheck,
  CarFront,
  Check,
  CreditCard,
  Mail,
  MapPin,
  MessageCircleQuestion,
} from "lucide-react";

export const dynamic = "force-dynamic";
export default async function Home() {
  const available = await publicInventory("available");
  const hasInventory = available.length > 0;
  const homepageVehicles = featuredHomepageVehicles(available, photoUrl);
  return (
    <>
      <section className="home-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="kicker kicker-on-dark">
              <span className="status-dot" />
              Family owned in New Bern since 2019
            </span>
            <h1>
              Used cars without the <span>runaround.</span>
            </h1>
            <p className="hero-lead">
              Find a high-quality used vehicle with friendly people, clear
              answers, and financing options. We’re here to make your next
              purchase smooth, transparent, and fun.
            </p>
            <div className="button-row">
              <Link className="button button-primary" href="/inventory">
                Shop inventory <ArrowRight aria-hidden="true" size={19} />
              </Link>
              <Link
                className="button button-ghost"
                href="/inventory#vehicle-request"
              >
                Tell us what you need
              </Link>
            </div>
            <div className="hero-trust">
              <BadgeCheck aria-hidden="true" size={21} />
              <span>
                Quality vehicles, clear pricing, and personal service from first
                hello to the road ahead.
              </span>
            </div>
          </div>
          {homepageVehicles.length ? (
            <HomepageInventory vehicles={homepageVehicles} />
          ) : (
            <div className="hero-media hero-brand-panel">
              <span className="kicker kicker-on-dark">
                Your next set of keys
              </span>
              <Image
                src="/drive-max-logo-transparent.webp"
                alt="Drive Max Used Cars"
                width={1064}
                height={532}
                sizes="(max-width: 760px) 80vw, 440px"
              />
              <h2>Local people. Personal service.</h2>
              <p>
                Quality used vehicles and a team that’s here for you before,
                during, and after the sale.
              </p>
              <Link
                className="button button-light"
                href={
                  hasInventory ? "/inventory" : "/inventory#vehicle-request"
                }
              >
                {hasInventory
                  ? "Find your next vehicle"
                  : "Tell us what you’re looking for"}{" "}
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="quick-actions" aria-label="Popular actions">
        <div className="container quick-actions-grid">
          <Link href="/inventory#vehicle-request" className="quick-action">
            <CarFront aria-hidden="true" />
            <span>
              <strong>Looking for a vehicle?</strong>
              <small>Tell us make, model, budget, or body style</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/apply" className="quick-action">
            <BadgeDollarSign aria-hidden="true" />
            <span>
              <strong>Explore financing</strong>
              <small>Start with a basic financing inquiry</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/payments" className="quick-action">
            <CreditCard aria-hidden="true" />
            <span>
              <strong>Already a customer?</strong>
              <small>Get help with your Drive Max account</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <FeaturedInventory />
      <section className="section sell-home-section">
        <div className="container sell-home-card">
          <div>
            <span className="kicker">We buy vehicles</span>
            <h2>Ready to sell your car?</h2>
            <p>
              Send us your VIN, mileage, and a few details. Our team will review
              your vehicle and follow up to discuss a purchase offer.
            </p>
          </div>
          <Link className="button button-primary" href="/sell-your-car">
            Get a purchase offer <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </section>
      {!hasInventory && (
        <section className="section inventory-intro">
          <div className="container">
            <div className="section-heading section-heading-split">
              <div>
                <span className="kicker">Inventory</span>
                <h2>Let’s find your next vehicle.</h2>
              </div>
              <p>
                Have a specific make, model, or budget in mind? Tell us what
                matters to you and let our team help with your search.
              </p>
            </div>
            <div className="inventory-status-panel">
              <div className="inventory-icon-panel">
                <CarFront aria-hidden="true" size={68} />
              </div>
              <div className="inventory-status-copy">
                <span className="availability-pill">
                  <span className="status-dot" /> Personal vehicle search
                </span>
                <h3>Looking for something specific?</h3>
                <p>
                  Tell us what you’re shopping for now. We can follow up when a
                  vehicle matching your needs becomes available.
                </p>
                <Link className="text-link" href="/inventory#vehicle-request">
                  Send a vehicle request{" "}
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              </div>
              <div className="listing-includes">
                <span>Tell us your priorities</span>
                <ul>
                  <li>
                    <CarFront aria-hidden="true" size={18} /> Make, model, or
                    body style
                  </li>
                  <li>
                    <Check aria-hidden="true" size={18} /> Budget and mileage
                  </li>
                  <li>
                    <Check aria-hidden="true" size={18} /> Features that matter
                    to you
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

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
              <h3>Explore our inventory</h3>
              <p>
                Browse vehicle photos, mileage, pricing, and details to find
                your fit.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">02</span>
              <MessageCircleQuestion aria-hidden="true" />
              <h3>Ask before you drive</h3>
              <p>
                Get answers about a vehicle, financing, or your trade before
                scheduling a visit.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">03</span>
              <CalendarCheck aria-hidden="true" />
              <h3>Plan your visit</h3>
              <p>
                Confirm the vehicle and a visit time so your trip to the
                dealership has a purpose.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section finance-feature">
        <div className="container finance-feature-grid">
          <div>
            <span className="kicker kicker-on-dark">Financing</span>
            <h2>Let’s find a financing path that fits.</h2>
            <p>
              Tell us what you’re shopping for, your budget, and your planned
              down payment. We’ll follow up to discuss available options and
              next steps.
            </p>
            <Link className="button button-light" href="/apply">
              Start a financing request{" "}
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
          <ul className="finance-checklist">
            <li>
              <Check aria-hidden="true" /> A quick online inquiry
            </li>
            <li>
              <Check aria-hidden="true" /> Options based on your needs
            </li>
            <li>
              <Check aria-hidden="true" /> Personal follow-up from Drive Max
            </li>
          </ul>
        </div>
      </section>

      <section className="section location-section">
        <div className="container location-grid">
          <div className="location-copy">
            <span className="kicker">Find Drive Max</span>
            <h2>Easy to find in New Bern.</h2>
            <p>
              Visit us on Old US Highway 70 West. Browse the lot, meet the team,
              and let’s find your next vehicle.
            </p>
            <address>
              <MapPin aria-hidden="true" />
              <span>
                <strong>Drive Max Used Cars LLC</strong>
                <br />
                6210 Old US Hwy 70 West
                <br />
                New Bern, NC 28562
              </span>
            </address>
            <a className="contact-row" href="mailto:sales@drivemaxusedcars.com">
              <Mail aria-hidden="true" />
              sales@drivemaxusedcars.com
            </a>
            <div className="button-row">
              <a
                className="button button-primary"
                href="https://www.google.com/maps/dir/?api=1&destination=6210+Old+US+Hwy+70+West+New+Bern+NC+28562"
                target="_blank"
                rel="noreferrer"
              >
                Get directions <ArrowRight aria-hidden="true" size={18} />
              </a>
              <Link className="button button-secondary" href="/contact">
                Contact us
              </Link>
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
