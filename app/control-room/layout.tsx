import type { Metadata } from "next";
import "./control-room.css";
export const metadata: Metadata = {
  title: "Control Room",
  robots: { index: false, follow: false },
  alternates: { canonical: "/control-room" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="control-room">{children}</div>;
}
