import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.VERCEL_ENV==='production') {
 if(!process.env.POSTGRES_URL) throw new Error('CRM database configuration is required.');
 const url=new URL(process.env.POSTGRES_URL);
 if(url.hostname.endsWith('.pooler.supabase.com')) {url.searchParams.set('sslmode','verify-full');url.searchParams.set('sslrootcert',fileURLToPath(new URL('../certs/supabase-root-2021.crt',import.meta.url)));}
 const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000,query_timeout:20000});
 try {
  await client.connect();await client.query('begin');await client.query("set local statement_timeout='15s'");await client.query('select pg_advisory_xact_lock(76102601)');
  const check=await client.query("select to_regclass('public.dmcrm_orgs') as existing");
  if(!check.rows[0].existing) {await client.query(await fs.readFile(new URL('../db/001_crm.sql',import.meta.url),'utf8'));console.log('Isolated CRM schema installed.');}
  else console.log('CRM schema already installed.');
  await client.query('commit');
 }catch(e){await client.query('rollback').catch(()=>{});console.error('CRM migration failed; website tables unchanged. Code:',/^[A-Z0-9_]+$/.test(e?.code||'')?e.code:'UNKNOWN');process.exitCode=1;}
 finally{await client.end().catch(()=>{});}
}
