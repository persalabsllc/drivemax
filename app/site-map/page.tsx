import Link from "next/link";
import { pageMetadata, PUBLIC_PAGES } from "../../lib/seo";

export const metadata = pageMetadata({
  title: "Site Map",
  description:
    "Find Drive Max inventory, financing, contact information, local service areas, and dealership pages in one place.",
  path: "/site-map",
});

export default function SiteMap() {
  return (
    <>
      <section className="subpage-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Find your way</span>
          <h1>Site map</h1>
          <p>
            Everything you need to shop, plan a visit, and get to know Drive
            Max.
          </p>
        </div>
      </section>
      <section className="page-section">
        <div className="container">
          <nav aria-label="Site map">
            <ul className="site-map-grid">
              {PUBLIC_PAGES.filter((page) => page.path !== "/site-map").map(
                (page) => (
                  <li key={page.path}>
                    <Link href={page.path}>
                      {page.label} <span aria-hidden="true">→</span>
                    </Link>
                    <p>{page.description}</p>
                  </li>
                ),
              )}
            </ul>
          </nav>
          <p className="form-help">
            Looking for a specific vehicle? Our{" "}
            <Link className="text-link" href="/inventory">
              inventory page
            </Link>{" "}
            links to individual listings. Search engines can use our{" "}
            <a className="text-link" href="/sitemap.xml">
              XML sitemap
            </a>
            , which updates with published vehicle listings.
          </p>
        </div>
      </section>
    </>
  );
}
