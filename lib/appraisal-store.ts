import "server-only";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  appraisalSchema,
  compSchema,
  type Appraisal,
  type AppraisalComp,
  type SavedAppraisal,
  type Subject,
} from "./appraisal";
import { decryptMarketKey, encryptMarketKey } from "./appraisal-crypto";
import { marketDrivetrain } from "./appraisal-provider";

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
export function appraisalPool() {
  const connectionString =
    process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString)
    throw new Error(
      "Appraisal storage needs the Drive Max database connection.",
    );
  return (pool ||= new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    query_timeout: 10000,
  }));
}
export async function ensureAppraisalStorage() {
  if (!initialized)
    initialized = (async () => {
      const sql = await readFile(
        join(process.cwd(), "supabase/migrations/202610060001_appraisals.sql"),
        "utf8",
      );
      const client = await appraisalPool().connect();
      try {
        // A transaction advisory lock also makes simultaneous cold starts safe.
        await client.query("begin");
        await client.query("set local statement_timeout = '8s'");
        await client.query("select pg_advisory_xact_lock(76061006)");
        await client.query(
          sql.replace(/^begin;/m, "").replace(/^commit;/m, ""),
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      initialized = undefined;
      throw error;
    });
  return initialized;
}
type RecordRow = {
  id: string;
  vehicle_id: string | null;
  updated_at: string;
  title: string;
  payload: unknown;
};
function record(row: RecordRow): SavedAppraisal | null {
  const parsed = appraisalSchema.safeParse(row.payload);
  return parsed.success
    ? {
        id: row.id,
        vehicleId: row.vehicle_id,
        updatedAt: row.updated_at,
        title: row.title,
        data: parsed.data,
      }
    : null;
}
export async function listAppraisals() {
  await ensureAppraisalStorage();
  const { rows } = await appraisalPool().query<RecordRow>(
    "select id,vehicle_id,updated_at::text,title,payload from public.appraisal_records order by updated_at desc limit 200",
  );
  return rows.map(record).filter((r): r is SavedAppraisal => r !== null);
}
export async function findAppraisal(id: string) {
  await ensureAppraisalStorage();
  const { rows } = await appraisalPool().query<RecordRow>(
    "select id,vehicle_id,updated_at::text,title,payload from public.appraisal_records where id=$1",
    [id],
  );
  return rows[0] ? record(rows[0]) : null;
}
export async function persistAppraisal(
  data: Appraisal,
  staffId: string,
  id?: string,
  updatedAt?: string,
) {
  await ensureAppraisalStorage();
  const linked = await appraisalPool().query<{ id: string }>(
    "select id from public.vehicles where vin=$1",
    [data.subject.vin],
  );
  const title = [
    data.subject.year,
    data.subject.make,
    data.subject.model,
    data.subject.trim,
  ]
    .filter(Boolean)
    .join(" ");
  const values = [
    JSON.stringify(data),
    data.subject.vin,
    title,
    linked.rows[0]?.id || null,
  ];
  const { rows } = id
    ? await appraisalPool().query<RecordRow>(
        "update public.appraisal_records set payload=$1,vin=$2,title=$3,vehicle_id=$4,updated_at=now() where id=$5 and updated_at=$6::timestamptz returning id,vehicle_id,updated_at::text,title,payload",
        [...values, id, updatedAt],
      )
    : await appraisalPool().query<RecordRow>(
        "insert into public.appraisal_records(payload,vin,title,vehicle_id,id,created_by) values($1,$2,$3,$4,$5,$6) returning id,vehicle_id,updated_at::text,title,payload",
        [...values, randomUUID(), staffId],
      );
  if (!rows[0])
    throw new Error(
      "This appraisal changed in another session. Reload before saving.",
    );
  return record(rows[0])!;
}
export async function ownSaleComps(subject: Subject): Promise<AppraisalComp[]> {
  await ensureAppraisalStorage();
  const { rows } = await appraisalPool().query<{
    id: string;
    payload: unknown;
  }>(
    `select distinct on (vin) id,payload from public.appraisal_records
     where lower(payload->'subject'->>'make')=lower($1) and lower(payload->'subject'->>'model')=lower($2)
     and payload->'subject'->>'year'=$3 and payload->'subject'->>'zip'=$4
     and payload->'sale'->>'price' is not null and vin<>$5 order by vin,updated_at desc limit 200`,
    [
      subject.make,
      subject.model,
      String(subject.year),
      subject.zip,
      subject.vin,
    ],
  );
  const earliest = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  return rows.flatMap((row) => {
    const parsed = appraisalSchema.safeParse(row.payload);
    if (!parsed.success) return [];
    const data = parsed.data;
    if (
      !data.sale.price ||
      data.sale.date < earliest ||
      (marketDrivetrain(subject.drivetrain) !== null &&
        marketDrivetrain(data.subject.drivetrain) !==
          marketDrivetrain(subject.drivetrain)) ||
      Math.abs(data.subject.miles - subject.miles) > subject.mileageWindow ||
      (subject.exactTrim &&
        subject.trim &&
        data.subject.trim.toLowerCase() !== subject.trim.toLowerCase())
    )
      return [];
    const comp = compSchema.parse({
      id: `sale-${row.id}`,
      vin: data.subject.vin,
      title: [
        data.subject.year,
        data.subject.make,
        data.subject.model,
        data.subject.trim,
      ]
        .filter(Boolean)
        .join(" "),
      price: data.sale.price,
      miles: data.subject.miles,
      kind: "sold",
      source: "Drive Max · recorded sale",
      date: data.sale.date,
      url: "",
      dealer: "Drive Max",
      origin: "drivemax",
    });
    return [comp];
  });
}
export async function configuredMarketKey() {
  if (process.env.MARKETCHECK_API_KEY) return process.env.MARKETCHECK_API_KEY;
  await ensureAppraisalStorage();
  const { rows } = await appraisalPool().query<{ encrypted_key: string }>(
    "select encrypted_key from public.appraisal_connections where provider='marketcheck'",
  );
  return rows[0]
    ? decryptMarketKey(
        rows[0].encrypted_key,
        process.env.LEAD_RATE_LIMIT_SECRET || "",
      )
    : null;
}
export async function saveMarketConnection(key: string, staffId: string) {
  await ensureAppraisalStorage();
  const encrypted = encryptMarketKey(
    key,
    process.env.LEAD_RATE_LIMIT_SECRET || "",
  );
  await appraisalPool().query(
    "insert into public.appraisal_connections(provider,encrypted_key,updated_by) values('marketcheck',$1,$2) on conflict(provider) do update set encrypted_key=excluded.encrypted_key,updated_by=excluded.updated_by,updated_at=now()",
    [encrypted, staffId],
  );
}
export async function disconnectMarket() {
  if (process.env.MARKETCHECK_API_KEY)
    throw new Error(
      "This connection is managed in Vercel. Remove MARKETCHECK_API_KEY there to disconnect.",
    );
  await ensureAppraisalStorage();
  await appraisalPool().query(
    "delete from public.appraisal_connections where provider='marketcheck'",
  );
}
