import {NextRequest,NextResponse} from 'next/server';
import {session,workspace,db} from '../../../lib/server';
import {commandSchema} from '../../../lib/model';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){try{const s=await session();if(!s)return json({error:'Sign in to access your dealership.'},401);return json(await workspace(s));}catch{return json({error:'Your workspace could not be loaded. Please try again.'},503);}}
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid request origin.'},403);
 if(Number(req.headers.get('content-length')||0)>20000)return json({error:'Request too large.'},413);
 try{const s=await session();if(!s)return json({error:'Your session ended. Sign in again.'},401);
 const raw=await req.text();if(raw.length>20000)return json({error:'Request too large.'},413);
 let input:unknown;try{input=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 const parsed=commandSchema.safeParse(input);if(!parsed.success)return json({error:parsed.error.issues[0]?.message||'Check the information entered.'},400);
 const {data:id,error}=await db().rpc('dmcrm_command',{p_org:s.org_id,p_actor:s.user_id,p_command:parsed.data});if(error)return json({error:'The change could not be saved. Refresh and try again.'},400);
 return json({id,workspace:await workspace(s)});
 }catch{return json({error:'Could not save your change. Please try again.'},503);}
}
