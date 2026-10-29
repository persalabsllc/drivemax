import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";
import "./appointments.css";
import "./fi-menu.css";
import "./staff.css";
import "./inventory-print.css";
import "./sales-work.css";
import "./overview.css";
import "./profile-vehicles.css";
import "./appraisals.css";
import "./document-vault.css";
import "./title-clerk.css";
import "./overview-colors.css";
import "./vin-scanner.css";
import "./customer-links.css";
import "./customer-profile.css";
import "./license-scanner.css";
import "./business.css";
export const metadata: Metadata = {
  title: "Drive Max CRM",
  applicationName: "Drive Max CRM",
  description:
    "Drive Max staff workspace for customers, appointments, inventory, deals and follow-up.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
