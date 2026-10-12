export type CustomerReview = {
  id: string;
  firstName: string;
  /** Original review month, in the dealership’s America/New_York time zone. */
  month: string;
  quote: string;
  rating: number;
  source: "Google" | "Facebook";
  sourceUrl: string;
  kind: "excerpt" | "full";
};

export const GOOGLE_REVIEWS_URL =
  "https://www.google.com/maps/search/?api=1&query=Drive+Max+Used+Cars+New+Bern&query_place_id=ChIJvzL6lxvRqIkRLEFsYcr3ABM";

// Verified against original Google review records on October 12, 2026.
// Preserve spelling and punctuation. These are selected positive excerpts,
// not a complete review feed or a basis for an aggregate dealership rating.
// Original timestamps determine each month; relative dates are never estimated.
export const customerReviews: readonly CustomerReview[] = [
  {
    id: "ChZDSUhNMG9nS0VJQ0FnSUNkNklTVlBnEAE",
    firstName: "Justine",
    month: "2024-02",
    quote:
      "This was one of the best car buying experiences. Kyle was great, personable and communicated very well.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUNkNklTVlBnEAE!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgICd6ISVPg%7C%7C?hl=en-US",
    kind: "excerpt",
  },
  {
    id: "ChdDSUhNMG9nS0VJQ0FnSURzM09tWm5BRRAB",
    firstName: "Amber",
    month: "2020-02",
    quote:
      "My husband and I had an awesome used car buying experience with Kyle & Celeste! They are very friendly and professional.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSURzM09tWm5BRRAB!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgIDs3OmZnAE%7C%7C?hl=en-US",
    kind: "excerpt",
  },
  {
    id: "ChZDSUhNMG9nS0VJQ0FnSURNemNPc1pREAE",
    firstName: "Lisette",
    month: "2020-01",
    quote:
      "The test drive was pressure free and he maintained a hassle free environment. I would definitely do business here again.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSURNemNPc1pREAE!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgIDMzcOsZQ%7C%7C?hl=en-US",
    kind: "excerpt",
  },
  {
    id: "ChZDSUhNMG9nS0VJQ0FnSUNVemRXOGJnEAE",
    firstName: "Christina",
    month: "2019-07",
    quote:
      "From the moment I reached out to this company and inquired about an SUV I was met with warmth, and most importantly professionalism.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUNVemRXOGJnEAE!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgICUzdW8bg%7C%7C?hl=en-US",
    kind: "excerpt",
  },
];

export const featuredReviews = customerReviews.slice(0, 3);

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function reviewMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthFormatter.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
