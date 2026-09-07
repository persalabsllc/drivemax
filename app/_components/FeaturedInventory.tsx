import Link from "next/link";
import { publicInventory } from "../../lib/backend";
import VehicleCard from "./VehicleCard";
export default async function FeaturedInventory() {
  const available = await publicInventory("available");
  const featured = [...available]
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, 9);
  if (!featured.length) return null;
  return (
    <section className="section">
      <div className="container">
        <div className="section-heading section-heading-split">
          <div>
            <span className="kicker">On the lot</span>
            <h2>Find your next set of keys.</h2>
          </div>
          <Link className="button button-secondary" href="/inventory">
            Shop all inventory →
          </Link>
        </div>
        <div
          className="vehicle-rotator"
          aria-label="Available vehicles — scroll to browse"
        >
          {featured.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
        </div>
      </div>
    </section>
  );
}
