export const metadata = { robots: { index: false, follow: false } };
export default function VerifyHours() {
 return <div style={{padding:20, display:"flex", gap:20, alignItems:"start", flexWrap:"wrap"}}>
 {[{title:"Contact mobile 390",width:390,src:"/contact"},{title:"About mobile 320",width:320,src:"/about"}].map(v =>
 <section key={v.title}><h1 style={{fontSize:18}}>{v.title}</h1><iframe title={v.title} src={v.src} style={{width:v.width,height:1000,border:"1px solid #ccc"}} /></section>)}
 </div>;
}