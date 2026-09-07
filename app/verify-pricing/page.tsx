import type { Metadata } from "next";
export const metadata: Metadata = { title: "Pricing layout check", robots: { index: false, follow: false } };
export default function PricingLayoutCheck() {
  return <section style={{ padding: "24px", background: "#e9eef4" }}>
    <h1>Pricing layout check</h1>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "start" }}>
      {[
        ["Home 375", "/", 375],
        ["Inventory 320", "/inventory", 320],
        ["Vehicle 375", "/inventory/2018-nissan-pathfinder-s-f812def3", 375],
        ["Privacy 320", "/privacy-policy", 320],
      ].map(([label, src, width]) => <div key={label}>
        <h2>{label}</h2>
        <iframe title={String(label)} src={String(src)} width={Number(width)} height={760} style={{ display: "block", border: "1px solid #cbd5e1", boxSizing: "content-box" }} />
      </div>)}
    </div>
  </section>;
}
