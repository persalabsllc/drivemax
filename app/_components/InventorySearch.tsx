"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";

export default function InventorySearch() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function dismiss(event: Event) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    // A button click can blur the input without focusing the button. Wait for
    // actual outside focus instead of hiding the form during that click.
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="header-search"
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
        className="header-search-toggle"
        aria-label={open ? "Close inventory search" : "Search inventory"}
        title={open ? "Close inventory search" : "Search inventory"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <X size={20} aria-hidden="true" />
        ) : (
          <Search size={20} aria-hidden="true" />
        )}
      </button>
      <div id={id} className="header-search-panel" hidden={!open}>
        <form
          action="/inventory#inventory-results"
          method="get"
          role="search"
          aria-label="Inventory search"
        >
          <label htmlFor={`${id}-query`}>Find a vehicle</label>
          <div className="header-search-row">
            <input
              ref={inputRef}
              id={`${id}-query`}
              type="search"
              name="q"
              placeholder="Stock #, VIN, or make/model"
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button
              type="submit"
              aria-label="Find matching inventory"
              title="Search"
            >
              <ArrowRight size={20} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
