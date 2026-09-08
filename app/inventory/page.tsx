import type { Metadata } from "next";
import Link from "next/link";
import { publicInventory } from "../../lib/backend";
import { inventoryMatches } from "../../lib/inventory";
import VehicleCard from "../_components/VehicleCard";
import LeadForm from "../_components/ConnectedLeadForm";
import { inventoryPageMetadata } from "../../lib/seo";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  return inventoryPageMetadata(await searchParams);
}
export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const all = await publicInventory();
  const p = await searchParams;
  const q = typeof p.q === "string" ? p.q.slice(0, 100) : "",
    body = typeof p.body === "string" ? p.body : "",
    max = typeof p.max === "string" ? p.max : "";
  const searching = !!(q || body || max);
  const active = all.filter((v) => inventoryMatches(v, q, body, max));
  const sold = all.filter((v) => v.status === "sold");
  const styles = Array.from(
    new Set(
      all
        .filter((v) => v.status === "available")
        .map((v) => v.body_style)
        .filter(Boolean),
    ),
  ).sort();
  const page = Math.max(
      1,
      Math.floor(Number(typeof p.page === "string" ? p.page : 1) || 1),
    ),
    soldPage = Math.max(
      1,
      Math.floor(Number(typeof p.soldPage === "string" ? p.soldPage : 1) || 1),
    );
  const href = (next: number) =>
    `/inventory?${new URLSearchParams({ q, body, max, page: String(next) })}`;
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Drive Max inventory</span>
          <h1>Used car inventory in New Bern.</h1>
          <p>
            Explore the lot, get to know the details, and find a vehicle that
            fits your life.
          </p>
        </div>
      </section>
      <section className="page-section">
        <div className="container">
          <form className="inventory-filters" action="/inventory">
            <label>
              Make, model, or keyword
              <input
                name="q"
                defaultValue={q}
                placeholder="Try Toyota Camry"
                maxLength={100}
              />
            </label>
            <label>
              Body style
              <select name="body" defaultValue={body}>
                <option value="">All body styles</option>
                {styles.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Maximum total price
              <select
                name="max"
                defaultValue={max}
                aria-describedby="inventory-price-hint"
              >
                <option value="">Any price</option>
                {[10000, 15000, 20000, 25000, 35000, 50000].map((n) => (
                  <option key={n} value={n}>
                    ${n.toLocaleString()}
                  </option>
                ))}
              </select>
              <small id="inventory-price-hint">
                Includes $399 dealer fee; plus tax and tags.
              </small>
            </label>
            <button className="button button-primary">
              Search available cars
            </button>
            {searching && (
              <Link href="/inventory" className="text-link">
                Clear search
              </Link>
            )}
          </form>
          <div className="section-heading section-heading-split">
            <h2>{searching ? "Search results" : "Available now"}</h2>
            <p>
              {active.length} available{" "}
              {active.length === 1 ? "vehicle" : "vehicles"}
            </p>
          </div>
          {active.length ? (
            <>
              <div className="vehicle-grid">
                {active.slice((page - 1) * 12, page * 12).map((v) => (
                  <VehicleCard key={v.id} vehicle={v} />
                ))}
              </div>
              <div className="inventory-pagination">
                {page > 1 && <Link href={href(page - 1)}>← Previous</Link>}
                {active.length > page * 12 && (
                  <Link href={href(page + 1)}>More available vehicles →</Link>
                )}
              </div>
            </>
          ) : (
            <div className="inventory-empty">
              <h3>
                {searching
                  ? "No available vehicles match that search."
                  : "Let us help you find your next vehicle."}
              </h3>
              <p>
                Tell us what you’re looking for, and we’ll help you find your
                next vehicle.
              </p>
              <a className="button button-primary" href="#vehicle-request">
                Send a vehicle request
              </a>
            </div>
          )}
          {!searching && sold.length > 0 && (
            <section className="sold-archive">
              <div className="section-heading">
                <span className="kicker">Previously on our lot</span>
                <h2>Recently sold.</h2>
                <p>
                  These vehicles have found new owners and are no longer
                  available. See something you like? Ask us about a similar
                  vehicle.
                </p>
              </div>
              <div className="vehicle-grid">
                {sold.slice((soldPage - 1) * 9, soldPage * 9).map((v) => (
                  <VehicleCard key={v.id} vehicle={v} />
                ))}
              </div>
              <div className="inventory-pagination">
                {soldPage > 1 && (
                  <Link href={`/inventory?soldPage=${soldPage - 1}`}>
                    ← Previous sold listings
                  </Link>
                )}
                {sold.length > soldPage * 9 && (
                  <Link href={`/inventory?soldPage=${soldPage + 1}`}>
                    More sold listings →
                  </Link>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
      <section className="page-section page-section-muted" id="vehicle-request">
        <div className="container content-split">
          <div className="content-intro">
            <span className="kicker">Vehicle request</span>
            <h2>Have something specific in mind?</h2>
            <p>
              Tell us your preferred make, model, budget, and must-have
              features. We’ll be in touch.
            </p>
          </div>
          <LeadForm kind="vehicle" />
        </div>
      </section>
    </>
  );
}
