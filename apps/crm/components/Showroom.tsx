"use client";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Visit, dayKey, addDays } from "../lib/model";
import { Empty } from "./ui";
export function visitStatus(v: Visit) {
  return v.outcome === "sold" ? "sold" : v.departed_at ? "left" : "here";
}
export function Showroom({
  visits,
  card,
  onFindCustomer,
}: {
  visits: Visit[];
  card: (v: Visit) => ReactNode;
  onFindCustomer: () => void;
}) {
  const [date, setDate] = useState(dayKey()),
    [filter, setFilter] = useState("all");
  const today = dayKey();
  const dayVisits = visits.filter((v) => dayKey(v.arrived_at) === date),
    counts = {
      all: dayVisits.length,
      here: dayVisits.filter((v) => !v.departed_at).length,
      left: dayVisits.filter((v) => v.departed_at).length,
      sold: dayVisits.filter((v) => v.outcome === "sold").length,
    };
  const filtered = dayVisits
    .filter(
      (v) =>
        filter === "all" ||
        (filter === "here" && !v.departed_at) ||
        (filter === "left" && !!v.departed_at) ||
        (filter === "sold" && v.outcome === "sold"),
    )
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
  return (
    <>
      <div className="view-controls">
        <div className="date-control">
          <button
            aria-label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            aria-label="Showroom date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button
            aria-label="Next day"
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight size={18} />
          </button>
          <button onClick={() => setDate(today)}>Today</button>
        </div>
        <div className="segmented showroom-filters">
          {(["all", "here", "left", "sold"] as const).map((s) => (
            <button
              className={filter === s ? "chosen" : ""}
              key={s}
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
            >
              {s === "all"
                ? "All visits"
                : s === "here"
                  ? "Here"
                  : s === "left"
                    ? "Left"
                    : "Sold"}{" "}
              <b>{counts[s]}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="showroom-legend">
        <span>
          <i className="dot green" />
          Here
        </span>
        <span>
          <i className="dot left-dot" />
          Left
        </span>
        <span>
          <i className="dot sold-dot" />
          Sold
        </span>
        <p>
          End a visit when the customer leaves. Sold customers keep their sale
          status.
        </p>
      </div>
      {filtered.length ? (
        <div className="visit-grid full">{filtered.map(card)}</div>
      ) : (
        <section className="panel">
          <Empty
            title={
              dayVisits.length
                ? "No visits match this filter."
                : "No visits on this day."
            }
            body={
              dayVisits.length
                ? "Choose another status to see the rest of the day."
                : "Check a customer in from their profile when they arrive."
            }
            action={
              <button
                className="btn"
                onClick={
                  dayVisits.length ? () => setFilter("all") : onFindCustomer
                }
              >
                {dayVisits.length ? "Show all visits" : "Find a customer"}
              </button>
            }
          />
        </section>
      )}
    </>
  );
}
