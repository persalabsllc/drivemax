import Link from "next/link";
import { Clock3 } from "lucide-react";
import {
  APPOINTMENT_NOTE,
  BUSINESS_HOURS,
  businessHoursLabel,
} from "../../lib/business-hours";

export default function BusinessHours({
  compact = false,
  headingLevel: Heading = "h3",
}: {
  compact?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <section
      className={`business-hours${compact ? " business-hours-compact" : ""}`}
      aria-label="Business hours"
    >
      <div className="business-hours-heading">
        <Clock3 aria-hidden="true" size={compact ? 16 : 21} />
        <Heading>Business hours</Heading>
      </div>
      <dl className="business-hours-list">
        {BUSINESS_HOURS.map((hours) => (
          <div key={hours.day}>
            <dt>{hours.day}</dt>
            <dd
              className={hours.opens ? undefined : "business-hours-appointment"}
            >
              {businessHoursLabel(hours)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="business-hours-timezone">All times Eastern.</p>
      {!compact && (
        <p className="business-hours-note">
          {APPOINTMENT_NOTE}{" "}
          <Link href="/contact#contact-form">Request an appointment →</Link>
        </p>
      )}
    </section>
  );
}
