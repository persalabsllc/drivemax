"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import type { HomepageVehicle } from "../../lib/homepage-inventory";

export default function HomepageInventory({
  vehicles,
}: {
  vehicles: HomepageVehicle[];
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const count = vehicles.length;
  const activeIndex = index % Math.max(count, 1);
  const vehicle = vehicles[activeIndex];

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      if (motion.matches) setPlaying(false);
    };
    const syncVisibility = () => setHidden(document.hidden);
    syncMotion();
    syncVisibility();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (count < 2 || !playing || hovered || hidden) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [count, playing, hovered, hidden]);

  function move(direction: number) {
    setPlaying(false);
    setIndex((current) => (current + direction + count) % count);
  }

  if (!vehicle) return null;

  return (
    <section
      className="hero-media hero-inventory"
      aria-label="Featured inventory"
      aria-roledescription={count > 1 ? "carousel" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        // Browsing a vehicle stops rotation until the visitor starts it again.
        if (!(event.target as HTMLElement).closest("[data-rotation-control]"))
          setPlaying(false);
      }}
    >
      <div aria-live={playing ? "off" : "polite"} aria-atomic="true">
        <div
          role="group"
          aria-roledescription={count > 1 ? "slide" : undefined}
          aria-label={`${activeIndex + 1} of ${count}: ${vehicle.title}`}
        >
          <Link
            className="hero-inventory-photo"
            href={vehicle.href}
            aria-label={`View ${vehicle.title}`}
          >
            <Image
              key={vehicle.id}
              src={vehicle.photo}
              alt={vehicle.title}
              fill
              priority={activeIndex === 0}
              sizes="(max-width: 760px) calc(100vw - 30px), (max-width: 980px) calc(100vw - 40px), 50vw"
            />
          </Link>
          <div className="hero-inventory-details">
            <h2>{vehicle.title}</h2>
            <p>
              <strong>{vehicle.price}</strong>
              <span>{vehicle.mileage}</span>
            </p>
            <Link href={vehicle.href}>
              View vehicle <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
      <span className="hero-inventory-badge">Featured</span>
      {count > 1 && (
        <div
          className="hero-inventory-controls"
          aria-label="Slideshow controls"
        >
          <span aria-hidden="true">
            {activeIndex + 1} / {count}
          </span>
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous vehicle"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-rotation-control
            onClick={() => setPlaying((current) => !current)}
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
          >
            {playing ? (
              <Pause size={17} aria-hidden="true" />
            ) : (
              <Play size={17} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next vehicle"
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
