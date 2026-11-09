import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { featuredReviews } from "../../lib/reviews";
import ReviewCard from "./ReviewCard";
import CustomerGallery from "./CustomerGallery";
import {
  featuredCustomerPhotos,
  type GalleryPhoto,
} from "../../lib/customer-gallery";

export default function ReviewHighlights({
  photos = [],
}: {
  photos?: GalleryPhoto[];
}) {
  const featured = featuredCustomerPhotos(photos);
  return (
    <section
      className="section review-highlights family-section"
      aria-labelledby="customer-reviews-heading"
    >
      <div className="container">
        <div className="review-section-heading">
          <div className="section-heading">
            <span className="kicker">Proudly serving New Bern since 2019</span>
            <h2 id="customer-reviews-heading">The Drive Max family.</h2>
            <p>
              A few familiar faces, a lot of happy memories. Thank you for
              making Drive Max part of your story.
            </p>
          </div>
          <Link className="button button-secondary" href="/reviews">
            Meet more happy customers{" "}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <CustomerGallery photos={featured} />
        <span className="family-review-label">
          In our customers’ own words · selected Google and Facebook reviews
        </span>
        <div className="reviews-grid reviews-grid-featured">
          {featuredReviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      </div>
    </section>
  );
}
