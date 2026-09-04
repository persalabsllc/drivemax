import Link from 'next/link';
const vehicles=[
  {year:'2018',make:'Toyota',model:'Camry SE',miles:'96,000',price:'$15,995'},
  {year:'2017',make:'Honda',model:'CR-V EX',miles:'104,000',price:'$16,995'},
  {year:'2019',make:'Nissan',model:'Altima S',miles:'91,000',price:'$14,995'}
];
export default function Inventory(){return <><section className="pageHero"><span className="eyebrow">Current inventory</span><h1>Used Vehicles Under $20,000</h1><p className="sectionLead">Inventory changes quickly. These sample cards will be replaced by vehicles managed from the Drive Max control room.</p></section><section className="inventoryGrid">{vehicles.map((v,i)=><article className="glass card" key={i}><div className="invImage">🚗</div><span className="pill">In Stock</span><h3>{v.year} {v.make} {v.model}</h3><p>{v.miles} miles</p><div className="price">{v.price}</div><div className="actions"><Link className="primary" href="/apply">Apply for Credit</Link><Link className="secondary" href="/contact">Ask About This Vehicle</Link></div></article>)}</section></>}
