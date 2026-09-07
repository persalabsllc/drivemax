import HomepageInventory from "../_components/HomepageInventory";

export const metadata = { title: "Homepage verification", robots: { index: false, follow: false } };
const cars = [
  { id: "fixture-one", href: "/inventory#fixture-one", title: "TEST — First featured vehicle", photo: "/dealership-hero.webp", price: "$12,345", mileage: "40,000 miles" },
  { id: "fixture-two", href: "/inventory#fixture-two", title: "TEST — Second featured vehicle", photo: "/dealership-hero.webp", price: "$23,456", mileage: "50,000 miles" },
];
export default function Verification() {
  return <div className="container" style={{paddingBlock:30}}>
    <h1>Preview-only rotator verification</h1>
    <p>Synthetic display data only. No inventory or leads are created.</p>
    <div style={{maxWidth:600}}><HomepageInventory vehicles={cars}/></div>
    <h2>Compact card</h2>
    <div style={{width:320, maxWidth:"100%"}}><HomepageInventory vehicles={cars}/></div>
  </div>;
}
