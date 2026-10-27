"use client";
import { useEffect, useState } from "react";
import { RefreshCw, MessageSquare, Facebook, Globe } from "lucide-react";
import { canManage, type Workspace } from "../lib/model";
type Status = {facebook:{configured:boolean;last_received_at:string|null};sms:{provider:string;connected:boolean}};
export function IntegrationSettings({ws,demo}:{ws:Workspace;demo:boolean}) {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(""),[version,setVersion]=useState(0);
  const manager=canManage(ws.member.role);
  useEffect(()=>{
    if(demo || !manager)return;
    const abort=new AbortController();
    void fetch("/api/integrations",{cache:"no-store",signal:abort.signal}).then(async r=>{
      if(!r.ok)throw Error("Connection status could not load. Refresh to try again.");
      const result=await r.json();if(!abort.signal.aborted){setStatus(result);setError("");}
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return ()=>abort.abort();
  },[demo,manager,version]);
  if(!manager)return null;
  return <section className="panel integration-settings" aria-label="Lead sources and texting">
    <div className="section-heading"><div><h2>Lead sources &amp; texting</h2><p>Track which channels are ready to bring customers into Drive Max.</p></div>
      <button className="btn small" onClick={()=>setVersion(v=>v+1)} disabled={demo}><RefreshCw size={14}/> Refresh status</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="integration-cards">
      <article><Globe size={22}/><h3>Website inquiries</h3><strong>{demo?"Demo":ws.attention?.websiteIntake?.connected?"Connected":"Check connection"}</strong>
        <p>Vehicle inquiries, test drives, sell-your-car and financing forms create opportunities and follow-up tasks.</p></article>
      <article><Facebook size={22}/><h3>Facebook Page</h3><strong>{demo?"Demo":!status?"Checking…":status.facebook.last_received_at?"Receiving messages":status.facebook.configured?"Configured · awaiting first message":"Awaiting Meta connection"}</strong>
        <p>New Page messages create a customer and opportunity. Repeat messages stay together; ad references are kept when supplied.</p>
        {status?.facebook.last_received_at && <small>Last received: {new Date(status.facebook.last_received_at).toLocaleString("en-US",{timeZone:"America/New_York"})}</small>}
        <p className="ops-help">Connect the business Page in Meta, then test with a real vehicle inquiry. Personal Marketplace messages are separate.</p>
      </article>
      <article><MessageSquare size={22}/><h3>Telnyx SMS</h3><strong>{demo?"Demo":"Setup pending"}</strong>
        <p>Customer texting and employee text alerts are next. Existing drafts remain saved until the sending number and Telnyx connection are activated.</p></article>
    </div>
  </section>;
}
