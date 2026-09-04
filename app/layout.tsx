import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Drive Max Used Cars | New Bern, NC',
  description: 'Affordable used cars under $20,000 with in-house financing in New Bern, North Carolina.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand" aria-label="Drive Max Used Cars home">
            <span className="drive">Drive</span><span className="max">Max</span><span className="used">USED CARS</span>
          </Link>
          <nav>
            <Link href="/inventory">Inventory</Link>
            <Link href="/apply">Apply for Credit</Link>
            <Link href="/about">About Us</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/payments" className="payBtn">Make a Payment</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <div><strong>Drive Max Used Cars</strong><br/>6210 Old US Hwy 70 West, New Bern, NC 28562</div>
          <div><a href="mailto:hello@drivemaxusedcars.com">hello@drivemaxusedcars.com</a><br/>Serving New Bern since 2019</div>
        </footer>
      </body>
    </html>
  );
}
