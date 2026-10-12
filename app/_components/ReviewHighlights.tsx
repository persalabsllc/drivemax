import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { featuredReviews } from "../../lib/reviews";
import ReviewCard from "./ReviewCard";

export default function ReviewHighlights() {
  return (
    <section
      className="section review-highlights"
      aria-labelledby="customer-reviews-heading"
    >
      <div className="container">
        <div className="review-section-heading">
          <div className="section-heading">
            <span className="kicker">From our customers</span>
            <h2 id="customer-reviews-heading">
              Good experiences.
              <br />
              In their words.
            </h2>
            <p>
              Selected positive Google review excerpts, quoted word for word.
            </p>
          </div>
          <Link className="button button-secondary" href="/reviews">
            More customer reviews <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="reviews-grid reviews-grid-featured">
          {featuredReviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      </div>
    </section>
  );
}
