import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";
import "./appointments.css";
export const metadata: Metadata = {
  title: "Drive Max CRM",
  description: "Your dealership. Every relationship. One workspace.",
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
