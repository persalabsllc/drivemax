import './globals.css';
import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, MapPin } from 'lucide-react';
import MobileNav from './_components/MobileNav';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.drivemaxusedcars.com'),
  title: {
    default: 'Drive Max Used Cars | New Bern, NC',
    template: '%s | Drive Max Used Cars',
  },
  description:
    'Drive Max Used Cars is preparing to reopen in New Bern, NC with straightforward vehicle shopping and financing guidance.',
  alternates: { canonical: '/' },
  icons: { icon: '/drive-max-logo.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#08182d',
};

const primaryLinks = [
  { href: '/inventory', label: 'Inventory' },
  { href: '/sell-your-car', label: 'Sell your car' },
  { href: '/apply', label: 'Financing' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

function HeaderLinks() {
  return (
    <>
      {primaryLinks.map((link) => (
        <Link key={link.href} href={link.href} className="nav-link">
          {link.label}
        </Link>
      ))}
      <Link href="/payments" className="button button-small button-outline">
        Payment help
      </Link>
    </>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div className="announcement-bar">
          <div className="container announcement-inner">
            <span><MapPin aria-hidden="true" size={15} />6210 Old US Hwy 70 West, New Bern, NC</span>
            <Link href="mailto:sales@drivemaxusedcars.com"><Mail aria-hidden="true" size={15} />sales@drivemaxusedcars.com</Link>
          </div>
        </div>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand" aria-label="Drive Max Used Cars home">
              <Image
                src="/drive-max-logo-transparent.webp"
                alt="Drive Max Used Cars"
                width={1064}
                height={532}
                sizes="(max-width: 360px) 164px, (max-width: 384px) calc(100vw - 180px), (max-width: 760px) 204px, 270px"
                priority
              />
              <span className="brand-sparkle brand-sparkle-top" aria-hidden="true" />
              <span className="brand-sparkle brand-sparkle-bottom" aria-hidden="true" />
            </Link>
            <nav className="desktop-nav" aria-label="Primary navigation">
              <HeaderLinks />
            </nav>
            <MobileNav />
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <div className="container footer-grid">
            <div className="footer-brand-column">
              <Link href="/" className="footer-logo" aria-label="Drive Max Used Cars home">
                <Image src="/drive-max-logo-transparent.webp" alt="" width={1064} height={532} sizes="210px" />
              </Link>
              <div>
                <strong>Drive Max Used Cars LLC</strong>
                <p>A straightforward place to shop used vehicles in New Bern.</p>
              </div>
            </div>
            <div className="footer-column">
              <h2>Shop</h2>
              <Link href="/inventory">Inventory updates</Link>
              <Link href="/sell-your-car">Sell your car</Link>
              <Link href="/apply">Financing request</Link>
              <Link href="/payments">Payment help</Link>
            </div>
            <div className="footer-column">
              <h2>Dealership</h2>
              <Link href="/about">About Drive Max</Link>
              <Link href="/about/staff">Meet the team</Link>
              <Link href="/about/employment">Employment</Link>
            </div>
            <div className="footer-column footer-contact">
              <h2>Get in touch</h2>
              <a href="https://www.google.com/maps/dir/?api=1&destination=6210+Old+US+Hwy+70+West+New+Bern+NC+28562" target="_blank" rel="noreferrer">
                6210 Old US Hwy 70 West<br />New Bern, NC 28562
              </a>
              <a href="mailto:sales@drivemaxusedcars.com">sales@drivemaxusedcars.com</a>
            </div>
          </div>
          <div className="container footer-bottom">
            <span>© {new Date().getFullYear()} Drive Max Used Cars LLC</span>
            <Link href="/control-room">Staff login</Link>
            <span>Vehicle availability, pricing, and financing terms are subject to change.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
