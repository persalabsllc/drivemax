type ReviewContent = {
  id: string;
  firstName: string;
  /** Original review month, in the dealership’s America/New_York time zone. */
  month: string;
  quote: string;
  kind: "excerpt" | "full";
};

export type CustomerReview = ReviewContent &
  (
    | { source: "Google"; rating: number; sourceUrl: string }
    | { source: "Facebook"; recommended: true; sourceUrl?: string }
  );

export const GOOGLE_REVIEWS_URL =
  "https://www.google.com/maps/search/?api=1&query=Drive+Max+Used+Cars+New+Bern&query_place_id=ChIJvzL6lxvRqIkRLEFsYcr3ABM";

// Full text transcribed from owner-provided screenshots on October 12, 2026.
// Facebook months come from visible dates; Google months were verified against
// original review timestamps. Never estimate a month from a relative date.
// Preserve spelling, punctuation, capitalization, and emojis. These are selected
// positive reviews and recommendations (including one labeled excerpt),
// not a complete review feed or a basis for an aggregate dealership rating.
export const customerReviews: readonly CustomerReview[] = [
  {
    id: "ChZDSUhNMG9nS0VJQ0FnSUNkNklTVlBnEAE",
    firstName: "Justine",
    month: "2024-02",
    quote:
      "This was one of the best car buying experiences. Kyle was great, personable and communicated very well. Not only did he give me a great price, he showed compassion and care with my car buying experience. I couldn’t have been more appreciative of the experience.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUNkNklTVlBnEAE!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgICd6ISVPg%7C%7C?hl=en-US",
    kind: "full",
  },
  // IMG_1522.jpeg — March 13, 2020.
  {
    id: "facebook-kimberly-2020-03-13",
    firstName: "Kimberly",
    month: "2020-03",
    quote:
      "I want to say thank you for the great service I received from Drive Max! They were awesome and I’m so happy with my first Chrysler van!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1523.png — February 29, 2020.
  {
    id: "facebook-mary-2020-02-29",
    firstName: "Mary",
    month: "2020-02",
    quote:
      "I can not say enough about the wonderful experience I had here! I 100% would recommend this place! Kyle was so kind and helpful! From the moment I stepped in the door to the moment I drove off the lot, the service was flawless! I am so excited about my purchase! I will be doing business here in the future for sure! If you are in the car market, this is the place for you!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1523.png — February 26, 2020. Also posted on Google; display only once.
  {
    id: "facebook-amber-2020-02-26",
    firstName: "Amber",
    month: "2020-02",
    quote:
      "My husband and I had an awesome used car buying experience with Kyle & Celeste! They are very friendly and professional. Kyle answered all of our questions with honesty. Overall, was a very pleasurable buying experience, and we will definitely be returning when we are in the market for another used vehicle! Thank you Kyle & Celeste!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1523.png — January 30, 2020.
  {
    id: "facebook-julia-2020-01-30",
    firstName: "Julia",
    month: "2020-01",
    quote:
      "Kyle was awesome! He is very nice and also very helpful. The car I bought from him is great as well! Really recommend.",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1530.png; exact Google month verified from the original timestamp.
  {
    id: "ChZDSUhNMG9nS0VJQ0FnSURNemNPc1pREAE",
    firstName: "Lisette",
    month: "2020-01",
    quote:
      "Kyle was great, he stayed open late for my husband and I to see a vehicle that I was interested in. The test drive was pressure free and he maintained a hassle free environment. I would definitely do business here again. I have had the car for over a month now and no complaints, nothing mechanically wrong and provided a carfax.",
    rating: 5,
    source: "Google",
    sourceUrl:
      "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSURNemNPc1pREAE!2m1!1s0x0:0x1300f7ca616c412c!3m1!1s2@1:CIHM0ogKEICAgIDMzcOsZQ%7C%7C?hl=en-US",
    kind: "full",
  },
  // IMG_1523.png / IMG_1524.jpeg — January 19, 2020.
  {
    id: "facebook-dee-2020-01-19",
    firstName: "Dee",
    month: "2020-01",
    quote:
      "Awesome experience. Kyle was very helpful and answered all of our questions. Highly recommend!\n🤙🏽😎🤙🏽",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1525.png — January 14, 2020.
  {
    id: "facebook-rickey-2020-01-14",
    firstName: "Rickey",
    month: "2020-01",
    quote:
      "Awesome experience. Bought a great used 2004 Tahoe for our daughter’s  first vehicle\nCouldn’t be happier",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1525.png — December 25, 2019.
  {
    id: "facebook-matt-2019-12-25",
    firstName: "Matt",
    month: "2019-12",
    quote:
      "The guys at Drive Max Used Cars are great. Good service, super easy to work with, and we got a heck of a deal. Check them out if you’re in need of a vehicle.",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1525.png — December 23, 2019.
  {
    id: "facebook-crystal-2019-12-23",
    firstName: "Crystal",
    month: "2019-12",
    quote:
      "Amazing service he goes above and beyond !! Even met us on non business hours to get my mother in law in a car",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1525.png — December 8, 2019.
  {
    id: "facebook-harry-2019-12-08",
    firstName: "Harry",
    month: "2019-12",
    quote:
      "I enjoyed our purchase with Kyle serving as our sales representative. He was both professional and personable. I would recommend this dealership to anyone in need of a used vehicle.",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1526.jpeg — November 10, 2019.
  {
    id: "facebook-amanda-2019-11-10",
    firstName: "Amanda",
    month: "2019-11",
    quote:
      "Kyle was awesome to work with! This is someone who definitely wants to sell you the best car possible and is not just trying to take your money! I will highly recommend him and his business to everyone!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1526.jpeg — October 7, 2019.
  {
    id: "facebook-mike-2019-10-07",
    firstName: "Mike",
    month: "2019-10",
    quote:
      "Need a daily driver. Purchased a Buick LeSabre in August. 2 months and no issues!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1526.jpeg / IMG_1527.jpeg — September 26, 2019.
  {
    id: "facebook-tori-2019-09-26",
    firstName: "Tori",
    month: "2019-09",
    quote:
      "very good people to work with! they took care of my tuscon when I got her. very reliable cars, and not pushy either! highly recommend drive max!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1527.jpeg / IMG_1528.png — September 13, 2019.
  {
    id: "facebook-angela-2019-09-13",
    firstName: "Angela",
    month: "2019-09",
    quote:
      "very nice and they work you I would recommend max cars to anyone",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // IMG_1527.jpeg / IMG_1528.png — August 19, 2019.
  {
    id: "facebook-tanya-2019-08-19",
    firstName: "Tanya",
    month: "2019-08",
    quote: "Great Experience! Staff helpful and friendly!",
    source: "Facebook",
    recommended: true,
    kind: "full",
  },
  // The matching Facebook screenshot (IMG_1528.png) cuts off the full review.
  // Retain the verified Google excerpt and its link to the complete original.
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

const featuredReviewIds = new Set([
  "ChZDSUhNMG9nS0VJQ0FnSUNkNklTVlBnEAE",
  "facebook-kimberly-2020-03-13",
  "facebook-julia-2020-01-30",
]);

export const featuredReviews = customerReviews.filter((review) =>
  featuredReviewIds.has(review.id),
);

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function reviewMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthFormatter.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
