import Link from 'next/link';

export default function Home(){
  return <>
    <section className="hero">
      <div>
        <span className="eyebrow">New Bern's affordable used car destination</span>
        <h1>Good Cars. Fair Prices. <span>Financing That Works.</span></h1>
        <p>Drive Max Used Cars has served New Bern since 2019 with dependable vehicles under $20,000 and flexible in-house financing options.</p>
        <div className="actions"><Link className="primary" href="/inventory">Shop Inventory</Link><Link className="secondary" href="/apply">Apply for Credit</Link></div>
      </div>
      <div className="glass heroCard">
        <div className="vehicleVisual">🚙</div>
        <span className="pill">Featured Vehicle</span>
        <h3>Fresh Inventory Arriving Weekly</h3>
        <div className="price">Vehicles under $20,000</div>
        <p>Check our inventory for current availability, pricing, mileage, and financing options.</p>
      </div>
    </section>
    <section className="section">
      <h2>Why Drive Max?</h2><p className="sectionLead">A straightforward car-buying experience built around affordable transportation.</p>
      <div className="cards">
        <div className="glass card"><span className="pill">Affordable</span><h3>Under $20,000</h3><p>We focus on value-priced used vehicles that fit real-world budgets.</p></div>
        <div className="glass card"><span className="pill">Flexible</span><h3>In-House Financing</h3><p>Credit challenges do not have to stop you from getting dependable transportation.</p></div>
        <div className="glass card"><span className="pill">Local</span><h3>Serving New Bern Since 2019</h3><p>We are locally operated and committed to serving our community.</p></div>
      </div>
    </section>
    <section className="section">
      <h2>Find Us in New Bern</h2><p className="sectionLead">6210 Old US Hwy 70 West, New Bern, NC 28562</p>
      <div className="glass mapWrap"><iframe title="Drive Max Used Cars location" loading="lazy" src="https://www.google.com/maps?q=6210%20Old%20US%20Hwy%2070%20West%20New%20Bern%20NC%2028562&output=embed" /></div>
    </section>
  </>
}
