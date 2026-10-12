import { ArrowUpRight, Quote, Star, ThumbsUp } from "lucide-react";
import { reviewMonthLabel, type CustomerReview } from "../../lib/reviews";

export default function ReviewCard({ review }: { review: CustomerReview }) {
  return (
    <figure className="review-card">
      <div className="review-card-top">
        <span className="review-source">
          {review.source === "Google" ? "Google review" : "Facebook"}
          {review.kind === "excerpt" ? " excerpt" : ""}
        </span>
        {review.source === "Google" ? (
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
        ) : (
          <span className="review-recommendation">
            <ThumbsUp size={15} aria-hidden="true" />
            Recommends
          </span>
        )}
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
      {review.sourceUrl && (
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
      )}
    </figure>
  );
}
