"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, ArrowUpRight } from "lucide-react";
import { type Workspace, type Customer, dayKey } from "../lib/model";
import {
  searchCustomers,
  type SearchFilters,
  type ZipPoints,
} from "../lib/operations";
import { Empty } from "./ui";
const defaults: SearchFilters = {
  query: "",
  vehicle: "",
  status: "all",
  from: "",
  to: "",
  zip: "",
  radius: 0,
  staff: "",
};
export function CustomerSearch({
  ws,
  query,
  onOpen,
  initialStatus = "all",
}: {
  ws: Workspace;
  query: string;
  initialStatus?: string;
  onOpen: (c: Customer, o?: string | null) => void;
}) {
  const [filters, setFilters] = useState({
      ...defaults,
      status: initialStatus,
    }),
    [points, setPoints] = useState<ZipPoints>({}),
    [geoError, setGeoError] = useState(""),
    [page, setPage] = useState(0);
  const f = {
    ...filters,
    query: [query, filters.query].filter(Boolean).join(" "),
  };
  useEffect(() => {
    if (!filters.radius || Object.keys(points).length) return;
    let active = true;
    fetch("/data/zip-centroids.json")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((p) => {
        if (active) setPoints(p);
      })
      .catch(() => {
        if (active)
          setGeoError(
            "ZIP distance reference could not load. Retry or use exact ZIP search.",
          );
      });
    return () => {
      active = false;
    };
  }, [filters.radius, points]);
  useEffect(() => setPage(0), [query]);
  const change = (p: Partial<SearchFilters>) => {
    setGeoError("");
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  };
  const invalid =
    f.from && f.to && f.from > f.to
      ? "The end date must be on or after the start date."
      : f.zip && !/^\d{5}$/.test(f.zip)
        ? "Enter a five-digit ZIP code."
        : f.radius && !f.zip
          ? "Enter a ZIP code for the center of the radius."
          : f.radius && f.zip && Object.keys(points).length && !points[f.zip]
            ? "This ZIP has no Census reference point. Use exact ZIP matching instead."
            : geoError;
  const rows = useMemo(
    () => searchCustomers(ws, f, points),
    [ws, filters, query, points],
  );
  const display = invalid ? [] : rows;
  const pageCount = Math.max(1, Math.ceil(display.length / 50)),
    current = Math.min(page, pageCount - 1);
  return (
    <section className="panel ops-search">
      <div className="section-heading">
        <div>
          <h2>
            <Search size={18} /> Customer & deal search
          </h2>
          <p>
            One profile per customer. Filter by any matching opportunity, then
            open the profile to see their deals.
          </p>
        </div>
        <button
          className="btn small"
          onClick={() => {
            setFilters(defaults);
            setPage(0);
          }}
        >
          Reset filters
        </button>
      </div>
      <div className="ops-filter-grid">
        <label>
          Name, phone, email or keyword
          <input
            value={filters.query}
            onChange={(e) => change({ query: e.target.value })}
            placeholder="Search customers and deals…"
          />
        </label>
        <label>
          Vehicle / VIN / stock number
          <input
            value={f.vehicle}
            onChange={(e) => change({ vehicle: e.target.value })}
            placeholder="2015 Ford, VIN, 1234…"
          />
        </label>
        <label>
          Opportunity status
          <select
            value={f.status}
            onChange={(e) =>
              change({
                status: e.target.value,
                ...(!["all", "sold"].includes(e.target.value)
                  ? { from: "", to: "" }
                  : {}),
              })
            }
          >
            <option value="all">All opportunities & customers</option>
            <option value="active">All active opportunities</option>
            <option value="new">New</option>
            <option value="working">Working</option>
            <option value="appointment">Appointment</option>
            <option value="sold">Sold</option>
            <option value="lost">Lost</option>
            <option value="none">No opportunities</option>
          </select>
        </label>
        <label>
          Assigned salesperson
          <select
            value={f.staff}
            onChange={(e) => change({ staff: e.target.value })}
          >
            <option value="">All salespeople</option>
            {ws.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sold from (inclusive)
          <input
            type="date"
            value={f.from}
            onChange={(e) =>
              change({
                from: e.target.value,
                status: e.target.value ? "sold" : f.status,
              })
            }
          />
        </label>
        <label>
          Sold through (inclusive)
          <input
            type="date"
            value={f.to}
            onChange={(e) =>
              change({
                to: e.target.value,
                status: e.target.value ? "sold" : f.status,
              })
            }
          />
        </label>
        <label>
          Customer ZIP code
          <input
            inputMode="numeric"
            maxLength={5}
            value={f.zip}
            onChange={(e) => change({ zip: e.target.value.replace(/\D/g, "") })}
            placeholder="28562"
          />
        </label>
        <label>
          Radius
          <select
            value={f.radius}
            onChange={(e) => change({ radius: Number(e.target.value) })}
          >
            <option value={0}>Exact ZIP</option>
            {[10, 25, 50, 75, 100, 150, 250, 350, 500].map((r) => (
              <option key={r} value={r}>
                Within {r} miles
              </option>
            ))}
          </select>
        </label>
      </div>
      {!!f.radius && (
        <p className="ops-help">
          Approximate straight-line distance between Census ZIP reference
          points, not driving distance. Customers with missing or unmapped ZIPs
          are excluded.
          {!Object.keys(points).length && !geoError
            ? " Loading ZIP reference…"
            : ""}
        </p>
      )}
      {invalid && (
        <p role="alert" className="form-error">
          {invalid}
        </p>
      )}
      <div className="ops-result-count">
        <SlidersHorizontal size={14} />
        {display.length} matching{" "}
        {display.length === 1 ? "customer" : "customers"}
      </div>
      {display.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Source</th>
                <th>ZIP / distance</th>
                <th>Salesperson</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {display
                .slice(current * 50, current * 50 + 50)
                .map(({ customer: c, zip, miles }) => (
                  <tr key={c.id}>
                    <td>
                      <button className="name-button" onClick={() => onOpen(c)}>
                        {c.name}
                      </button>
                      <small className="subtext">{c.phone || c.email}</small>
                    </td>
                    <td>{c.email || "—"}</td>
                    <td>{c.source || "—"}</td>
                    <td>
                      {zip || "—"}
                      {!!f.radius && miles !== null && (
                        <small className="subtext">{miles.toFixed(1)} mi</small>
                      )}
                    </td>
                    <td>
                      {ws.staff.find((s) => s.id === c.assigned_to)?.name ||
                        "Unassigned"}
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`Open ${c.name} profile`}
                        onClick={() => onOpen(c)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No matching customers"
          body="Adjust the date range, vehicle, status or location filters."
        />
      )}
      {pageCount > 1 && (
        <div className="ops-pagination">
          <button
            className="btn small"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <span>
            Page {current + 1} of {pageCount}
          </span>
          <button
            className="btn small"
            disabled={current + 1 >= pageCount}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
