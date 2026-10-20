import { dealershipEmail, leadEmailFrom } from "./email-config";
import { leadLabel, purchaseLabels } from "./purchase-requests";
import { smsConsentSummary } from "./contact-notice";

export type NotificationPayload = {
  leadId: string;
  name: string;
  email: string;
  phone: string;
  preferredContact: string;
  kind: string;
  details: Record<string, string>;
  body: string;
  subject: string;
  isReply: boolean;
};

const detailLabels: Record<string, string> = {
  ...purchaseLabels,
  vehicle: "Vehicle of interest",
  budget: "Budget",
  position: "Position or area of interest",
  originalVehicleTitle: "Original vehicle",
  originalVehicleVin: "Vehicle VIN",
  originalVehicleStock: "Stock number",
  originalVehicleMiles: "Listed mileage",
};

export function notificationMessage(payload: NotificationPayload) {
  const label = payload.isReply
    ? "Customer reply"
    : payload.details.purpose === "purchase-offer"
      ? "Sell your car request"
      : leadLabel({ kind: payload.kind, details: payload.details });
  const subject = `[Drive Max] ${label} — ${payload.name}`
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 200);
  return {
    from: leadEmailFrom(),
    to: dealershipEmail,
    // Reply in the sales inbox to reach the customer; never impersonate their From address.
    replyTo: payload.email || dealershipEmail,
    subject,
    text: [
      `Drive Max — ${label}`,
      "",
      `Name: ${payload.name}`,
      `Email: ${payload.email || "Not provided"}`,
      `Phone: ${payload.phone}`,
      `Preferred contact: ${payload.preferredContact}`,
      `Customer care text message consent: ${smsConsentSummary(payload.details.smsConsent)}`,
      "",
      ...Object.entries(detailLabels).flatMap(([key, title]) =>
        payload.details[key] ? [`${title}: ${payload.details[key]}`] : [],
      ),
      "",
      payload.isReply && payload.subject ? `Subject: ${payload.subject}` : "",
      payload.body,
      "",
      `Open in Control Room: https://www.drivemaxusedcars.com/control-room?tab=leads&lead=${encodeURIComponent(payload.leadId)}#lead-editor`,
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
  };
}
