"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

const links = [
  { href: "/about/staff", label: "Meet the staff" },
  { href: "/about/employment", label: "Employment" },
  { href: "/about", label: "About" },
];

export default function AboutNav({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className={mobile ? "about-nav about-nav-mobile" : "about-nav"}
      onPointerEnter={(event) => {
        if (!mobile && event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (!mobile && !event.currentTarget.contains(document.activeElement))
          setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={
          mobile
            ? "mobile-nav-link about-nav-trigger"
            : "nav-link about-nav-trigger"
        }
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        About us <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={id} className="about-nav-panel" hidden={!open}>
        <div className="about-nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
