import { ArrowUpRight, Quote, Star } from "lucide-react";
import { reviewMonthLabel, type CustomerReview } from "../../lib/reviews";

export default function ReviewCard({ review }: { review: CustomerReview }) {
  return (
    <figure className="review-card">
      <div className="review-card-top">
        <span className="review-source">{review.source} review</span>
        <span
          className="review-stars"
          role="img"
          aria-label={`${review.rating} out of 5 stars`}
        >
          {Array.from({ length: review.rating }, (_, index) => (
            <Star
              key={index}
              size={15}
              fill="currentColor"
              aria-hidden="true"
            />
          ))}
        </span>
      </div>
      <Quote className="review-quote-icon" size={30} aria-hidden="true" />
      <blockquote cite={review.sourceUrl}>
        <p>{review.quote}</p>
      </blockquote>
      <figcaption>
        <span className="review-avatar" aria-hidden="true">
          {review.firstName.slice(0, 1)}
        </span>
        <span className="review-attribution">
          <strong>{review.firstName}</strong>
          <time dateTime={review.month}>{reviewMonthLabel(review.month)}</time>
        </span>
      </figcaption>
      <a
        className="review-original"
        href={review.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {review.kind === "excerpt"
          ? "Read full review"
          : "View original review"}{" "}
        on {review.source}
        <ArrowUpRight size={15} aria-hidden="true" />
      </a>
    </figure>
  );
}
