import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageSquareQuote } from "lucide-react";
import { customerReviews, GOOGLE_REVIEWS_URL } from "../../lib/reviews";
import { pageMetadata } from "../../lib/seo";
import ReviewCard from "../_components/ReviewCard";

export const metadata = pageMetadata({
  title: "Customer Reviews in New Bern, NC",
  description:
    "Read positive Google reviews and Facebook recommendations from Drive Max Used Cars customers, in their own words, with first names and original review dates.",
  path: "/reviews",
});

export default function ReviewsPage() {
  return (
    <>
      <section className="subpage-hero reviews-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Customer reviews</span>
          <h1>A few words from the people who know us.</h1>
          <p>
            Our customers make Drive Max what it is. Here are a few of the
            experiences they’ve shared about buying a vehicle with our New Bern
            team.
          </p>
          <div className="button-row">
            <a
              className="button button-light"
              href={GOOGLE_REVIEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit our Google reviews{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <Link className="button button-ghost" href="/about">
              Get to know Drive Max
            </Link>
          </div>
        </div>
      </section>
      <section
        className="section reviews-section"
        aria-labelledby="featured-reviews-heading"
      >
        <div className="container">
          <div className="section-heading">
            <span className="kicker">Shared in their own words</span>
            <h2 id="featured-reviews-heading">Customer highlights.</h2>
            <p>
              Selected positive reviews and recommendations from Google and
              Facebook, shared in our customers’ own words.
            </p>
          </div>
          <div className="reviews-grid">
            {customerReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
          <p className="reviews-note">
            These are selected highlights, not a complete list of reviews.{" "}
            <a
              href={GOOGLE_REVIEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Explore more feedback on Google{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            .
          </p>
        </div>
      </section>
      <section className="section reviews-next-section">
        <div className="container reviews-next-card">
          <MessageSquareQuote
            className="reviews-next-icon"
            size={40}
            aria-hidden="true"
          />
          <div>
            <span className="kicker">Your next chapter</span>
            <h2>Let’s find your next set of keys.</h2>
            <p>
              Explore our inventory or tell us what you’re looking for. We’re
              happy to help.
            </p>
          </div>
          <Link className="button button-primary" href="/inventory">
            Shop inventory <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  );
}
