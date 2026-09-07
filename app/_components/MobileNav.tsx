'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu } from 'lucide-react';

const links = [
  { href: '/inventory', label: 'Inventory' },
  { href: '/sell-your-car', label: 'Sell your car' },
  { href: '/apply', label: 'Financing' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export default function MobileNav() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details ref={detailsRef} className="mobile-nav">
      <summary>
        <Menu aria-hidden="true" size={21} />
        <span>Menu</span>
        <ChevronDown className="menu-chevron" aria-hidden="true" size={18} />
      </summary>
      <nav aria-label="Mobile navigation">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="mobile-nav-link" onClick={closeMenu}>
            {link.label}
          </Link>
        ))}
        <Link href="/payments" className="button button-small button-outline mobile-payment" onClick={closeMenu}>
          Payment help
        </Link>
      </nav>
    </details>
  );
}
