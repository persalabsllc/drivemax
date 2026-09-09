// New Bern local time. Keep visible hours and search-engine data in sync.
export const BUSINESS_HOURS = [
  { day: "Monday", opens: null, closes: null },
  { day: "Tuesday", opens: "09:00", closes: "17:00" },
  { day: "Wednesday", opens: "09:00", closes: "17:00" },
  { day: "Thursday", opens: "09:00", closes: "17:00" },
  { day: "Friday", opens: "09:00", closes: "17:00" },
  { day: "Saturday", opens: "12:00", closes: "16:00" },
  { day: "Sunday", opens: null, closes: null },
] as const;

export const APPOINTMENT_NOTE =
  "Monday and Sunday visits are by appointment. Contact us to arrange a time.";

export function formatBusinessTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours >= 12 ? "PM" : "AM"}`;
}

export function businessHoursLabel(hours: (typeof BUSINESS_HOURS)[number]) {
  return hours.opens && hours.closes
    ? `${formatBusinessTime(hours.opens)} – ${formatBusinessTime(hours.closes)}`
    : "By appointment";
}

// Appointment-only days have no fixed opening/closing times. Do not advertise
// them as closed (00:00–00:00) or open all day; explain them in visible copy.
export const REGULAR_OPENING_HOURS = BUSINESS_HOURS.flatMap((hours) =>
  hours.opens && hours.closes
    ? [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: `https://schema.org/${hours.day}`,
          opens: hours.opens,
          closes: hours.closes,
        },
      ]
    : [],
);
