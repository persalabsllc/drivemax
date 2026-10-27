"use client";
import { useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, Filter, Search } from "lucide-react";
import { dayKey, type Workspace, type Customer } from "../lib/model";
import {
  funnelSteps,
  overviewFunnel,
  type FunnelStep,
} from "../lib/overview-funnel";
import { Avatar, Empty, Modal, SectionTitle } from "./ui";

export function OverviewFunnel({
  ws,
  onCustomer,
}: {
  ws: Workspace;
  onCustomer: (c: Customer, id?: string | null) => void;
}) {
  const [period, setPeriod] = useState("month"),
    [selected, setSelected] = useState<FunnelStep | null>(null),
    [query, setQuery] = useState("");
  const today = dayKey(),
    from =
      period === "today"
        ? today
        : period === "month"
          ? today.slice(0, 7) + "-01"
          : "1900-01-01";
  const to =
    period === "month"
      ? new Date(
          Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10)
      : period === "all"
        ? "9999-12-31"
        : today;
  const buckets = useMemo(() => overviewFunnel(ws, from, to), [ws, from, to]);
  const step = funnelSteps.find((s) => s.key === selected),
    label =
      period === "month"
        ? "This month"
        : period === "today"
          ? "Today"
          : "All time";
  const rows = selected
    ? buckets[selected].filter((r) =>
        [
          r.customer.name,
          r.customer.email,
          r.customer.phone,
          r.opportunity?.vehicle_interest,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];
  return (
    <>
      <section
        className="panel overview-funnel"
        aria-label="Sales activity funnel"
      >
        <SectionTitle
          title="Sales activity"
          subtitle="Follow the customer journey. Click a step to see who’s there."
          action={<Filter size={17} aria-hidden="true" />}
        />
        <div className="funnel-toolbar">
          <span>Unique customers at each step</span>
          <select
            aria-label="Funnel period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="today">Today</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div className="funnel-steps">
          {funnelSteps.map((s, index) => (
            <button
              key={s.key}
              className={`funnel-step funnel-${s.key}`}
              style={{ "--funnel-inset": `${index * 5}%` } as CSSProperties}
              onClick={() => {
                setQuery("");
                setSelected(s.key);
              }}
              aria-label={`${s.label}: ${buckets[s.key].length} customers`}
            >
              <span>{s.label}</span>
              <strong>{buckets[s.key].length}</strong>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="funnel-note">
          Activity during this period. Customers may appear in more than one
          step; repeat deals count once per step.
        </p>
      </section>
      {step && selected && (
        <Modal
          title={`${step.label} · ${label}`}
          subtitle={`${buckets[selected].length} customers · ${step.detail}`}
          onClose={() => setSelected(null)}
        >
          <div className="funnel-detail">
            <label className="funnel-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search funnel customers"
                placeholder="Find a customer or vehicle…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="funnel-customers">
              {rows.map((r) => (
                <button
                  key={r.customer.id}
                  className="funnel-customer"
                  onClick={() => {
                    setSelected(null);
                    onCustomer(r.customer, r.opportunity?.id ?? null);
                  }}
                >
                  <Avatar name={r.customer.name} />
                  <div>
                    <strong>{r.customer.name}</strong>
                    <span>
                      {r.opportunity?.vehicle_interest ||
                        r.customer.vehicle_interest ||
                        "General inquiry"}
                    </span>
                    <small>
                      {ws.staff.find(
                        (s) =>
                          s.id ===
                          (r.opportunity?.assigned_to ??
                            r.customer.assigned_to),
                      )?.name ?? "Unassigned"}
                      {r.opportunityIds.length > 1
                        ? ` · ${r.opportunityIds.length} related opportunities`
                        : ""}
                    </small>
                  </div>
                  <time>
                    {new Date(
                      r.at.length === 10 ? r.at + "T12:00:00Z" : r.at,
                    ).toLocaleDateString("en-US", {
                      timeZone: "America/New_York",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {!rows.length && (
              <Empty
                title={
                  query
                    ? "No matching customers"
                    : "No customers in this step yet"
                }
                body={
                  query
                    ? "Try a different name or vehicle."
                    : "Recorded activity will appear here as your team works."
                }
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
