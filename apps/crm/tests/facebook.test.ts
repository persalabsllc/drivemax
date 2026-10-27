import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FacebookThread } from "../components/FacebookThread";
import { IntegrationSettings } from "../components/IntegrationSettings";
import { demoWorkspace } from "../lib/demo";
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { facebookEvents } from "../lib/facebook";
import { validFacebookSignature, limitedBody } from "../lib/webhook-security";
import { verifyFacebook } from "../scripts/verify-facebook.mjs";

test("Facebook webhook signature protects exact bytes, including Unicode",async()=>{
  const raw=Buffer.from('{"text":"Hello 🚙"}'),secret="test-only-app-secret";
  const signature="sha256="+createHmac("sha256",secret).update(raw).digest("hex");
  assert(validFacebookSignature(raw,signature,secret));
  assert(!validFacebookSignature(Buffer.concat([raw,Buffer.from(" ")]),signature,secret));
  assert(!validFacebookSignature(raw,signature,""));
  assert(!validFacebookSignature(raw,"sha256=00",secret));
  assert(!validFacebookSignature(raw,signature,"wrong"));
  assert.equal((await limitedBody(new Request("https://test.invalid",{method:"POST",body:"ok"}),2)).toString(),"ok");
  await assert.rejects(limitedBody(new Request("https://test.invalid",{method:"POST",body:"oversized"}),2),/too_large/);
});

test("Facebook parser accepts only incoming messages for the configured Page",()=>{
  const now=Date.now(),page="12345",vehicle=randomUUID();
  const event={sender:{id:"67890"},recipient:{id:page},timestamp:now,message:{mid:"m_1",text:"Is 3FAHP08199R161851 available?",referral:{ad_id:"777",ref:`vehicle:${vehicle}`}}};
  const parse=(events:unknown[])=>facebookEvents({object:"page",entry:[{id:page,messaging:events}]},page,now);
  assert.equal(parse([event])[0].vin,"3FAHP08199R161851");
  assert.equal(parse([event])[0].vehicle_id,vehicle);
  assert.equal(parse([event])[0].referral.ad_id,"777");
  assert.deepEqual(parse([{...event,message:{...event.message,is_echo:true}},{...event,recipient:{id:"999"}},{sender:{id:"67890"},read:{watermark:now}}]),[]);
  assert.deepEqual(facebookEvents({object:"page",entry:[{id:"999",messaging:[event]}]},page,now),[]);
  assert.deepEqual(facebookEvents({object:"instagram",entry:[{id:page,messaging:[event]}]},page,now),[]);
  const attachment=parse([{...event,message:{mid:"m_2",attachments:[{type:"image",payload:{url:"https://untrusted.invalid/image"}}]}}])[0];
  assert.match(attachment.body,/attachment/);assert(!attachment.body.includes("untrusted.invalid"));
});

test("Facebook intake creates assigned work safely, deduplicates retries and preserves prior deals",async(t)=>{
  const pg=new PGlite(),org="d5a1c100-0000-4000-8000-000000000001";
  const owner=randomUUID(),sales=randomUUID(),other=randomUUID(),page="12345",sender="67890";
  const one=async(sql:string,args:unknown[]=[]) => (await pg.query<any>(sql,args)).rows[0];
  const event=(extra:Record<string,unknown>={})=>({sender_id:sender,message_id:randomUUID(),body:"Is this still available?",received_at:new Date().toISOString(),referral:{},...extra});
  const receive=async(e:Record<string,unknown>,p=page,o=org)=>{
    const result=await one("select dmcrm_receive_facebook($1,$2,$3::jsonb) id",[o,p,JSON.stringify(e)]);
    return one("select * from dmcrm_facebook_messages where id=$1",[result.id]);
  };
  try {
    await pg.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
    for(const file of ["202609070001_control_room.sql","202610190001_lead_notifications.sql"])
      await pg.exec(await fs.readFile(new URL("../../../supabase/migrations/"+file,import.meta.url),"utf8"));
    await pg.exec(`insert into auth.users(id,email) values('${owner}','owner@example.invalid'),('${sales}','sales@example.invalid'),('${other}','other@example.invalid');insert into staff(id,email,name,role) values('${owner}','owner@example.invalid','Owner','owner');`);
    for(const file of (await fs.readdir(new URL("../db/",import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort())
      await pg.exec(await fs.readFile(new URL("../db/"+file,import.meta.url),"utf8"));
    await pg.exec(`insert into dmcrm_members(org_id,user_id,name,role) values('${org}','${sales}','Sales','sales'),('${org}','${other}','Other','sales');insert into dmcrm_staff(org_id,user_id,name,email,role) values('${org}','${sales}','Sales','sales@example.invalid','sales'),('${org}','${other}','Other','other@example.invalid','sales');`);
    const staff=(await one("select id from dmcrm_staff where org_id=$1 and user_id=$2",[org,sales])).id;
    const original=event();const first=await receive(original);
    await t.test("one profile, opportunity and task for the first message; retries return the same record",async()=>{
      assert.equal((await receive(original)).id,first.id);
      assert.equal((await one("select count(*)::int n from dmcrm_customers")).n,1);
      assert.equal((await one("select count(*)::int n from dmcrm_opportunities")).n,1);
      assert.equal((await one("select count(*)::int n from dmcrm_tasks")).n,1);
      assert.equal((await one("select source from dmcrm_customers where id=$1",[first.customer_id])).source,"Facebook Messenger");
      assert.equal((await one("select phone from dmcrm_customers where id=$1",[first.customer_id])).phone,"");
    });
    await t.test("replies keep identity and opportunity, without replacing edited contact details",async()=>{
      await pg.query("update dmcrm_customers set name='Morgan Customer',phone='2025550100' where id=$1",[first.customer_id]);
      const next=await receive(event());assert.equal(next.customer_id,first.customer_id);assert.equal(next.opportunity_id,first.opportunity_id);
      assert.equal((await one("select name from dmcrm_customers where id=$1",[first.customer_id])).name,"Morgan Customer");
      assert.equal((await one("select count(*)::int n from dmcrm_tasks")).n,1);
      const distinct=await receive(event({sender_id:"67891"}));assert.notEqual(distinct.customer_id,first.customer_id);
    });
    await t.test("alerts respect current assignment and cannot be marked reviewed by another salesperson",async()=>{
      await pg.query("update dmcrm_opportunities set assigned_to=$1 where id=$2",[staff,first.opportunity_id]);
      const feed=async(actor:string)=>(await one("select dmcrm_attention($1,$2) data",[org,actor])).data;
      assert((await feed(sales)).items.some((a:any)=>a.key===`facebook:${first.id}`));
      assert(!(await feed(other)).items.some((a:any)=>a.key===`facebook:${first.id}`));
      await assert.rejects(pg.query("select dmcrm_command($1,$2,$3::jsonb)",[org,other,JSON.stringify({type:"review_attention",kind:"facebook",id:first.id})]),/unavailable/);
      await pg.query("select dmcrm_command($1,$2,$3::jsonb)",[org,sales,JSON.stringify({type:"review_attention",kind:"facebook",id:first.id})]);
      assert(!(await feed(sales)).items.some((a:any)=>a.key===`facebook:${first.id}`));
      assert((await feed(owner)).items.some((a:any)=>a.key===`facebook:${first.id}`));
    });
    await t.test("exact vehicle references attach stock; new vehicle interest preserves the old opportunity",async()=>{
      const a=randomUUID(),b=randomUUID();
      await pg.query("insert into dmcrm_inventory(id,org_id,stock_number,vin,year,make,model,mileage,cost,price,acquired_on) values($1,$3,'FB001','3FAHP08199R161851',2009,'Ford','Fusion',100000,2000,4000,current_date),($2,$3,'FB002','1HGCM82633A004352',2003,'Honda','Accord',100000,2000,4000,current_date)",[a,b,org]);
      const exact=await receive(event({vin:"3FAHP08199R161851"}));assert.equal(exact.opportunity_id,first.opportunity_id);
      assert.equal((await one("select inventory_id from dmcrm_opportunities where id=$1",[first.opportunity_id])).inventory_id,a);
      await pg.query("update dmcrm_opportunities set status='lost',closed_at=now() where id=$1",[first.opportunity_id]);
      const followup=await receive(event());assert.equal(followup.opportunity_id,first.opportunity_id);
      const newVehicle=await receive(event({vehicle_id:b,referral:{ad_id:"ad-222"}}));
      assert.notEqual(newVehicle.opportunity_id,first.opportunity_id);assert.equal(newVehicle.customer_id,first.customer_id);
      assert.equal((await one("select source from dmcrm_opportunities where id=$1",[newVehicle.opportunity_id])).source,"Facebook ad");
      assert.equal((await one("select inventory_id from dmcrm_opportunities where id=$1",[first.opportunity_id])).inventory_id,a);
    });
    await t.test("browser roles cannot call intake; cross-tenant intake is rejected",async()=>{
      await assert.rejects(receive(event(),page,randomUUID()),/Invalid Facebook/);
      await pg.exec("set role authenticated");
      await assert.rejects(pg.query("select dmcrm_receive_facebook($1,$2,$3::jsonb)",[org,page,JSON.stringify(event())]),/permission denied/);
      await assert.rejects(pg.query("select * from dmcrm_facebook_messages"),/permission denied/);
      await pg.exec("reset role");
    });
    await t.test("production smoke verification rolls back every fixture",async()=>{
      const before=(await one("select count(*)::int n from dmcrm_customers")).n;
      await pg.exec("begin");await verifyFacebook(pg);await pg.exec("commit");
      assert.equal((await one("select count(*)::int n from dmcrm_customers")).n,before);
    });
  } finally {await pg.close();}
});


test("Facebook thread and setup status render safe message text with honest connection labels",()=>{
  const ws=demoWorkspace(),customer=ws.customers[0];
  ws.facebook_messages=[{id:randomUUID(),org_id:ws.org.id,customer_id:customer.id,
    opportunity_id:ws.opportunities[0].id,body:'Is this car available? <script>example</script>',
    referral:{ad_id:'1234'},received_at:new Date().toISOString()}];
  const html=renderToStaticMarkup(createElement(FacebookThread,{ws,customerId:customer.id,busy:false}));
  assert(html.includes('Reply in Meta Inbox'));
  assert(html.includes('&lt;script&gt;example&lt;/script&gt;'));
  assert(!html.includes('<script>example'));
  const settings=renderToStaticMarkup(createElement(IntegrationSettings,{ws,demo:true}));
  assert(settings.includes('Telnyx SMS'));assert(settings.includes('Lead sources'));
});
