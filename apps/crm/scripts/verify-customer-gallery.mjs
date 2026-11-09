export async function verifyCustomerGallery(client) {
  const { rows } = await client.query(`select
    has_table_privilege('anon','public.dmcrm_site_photos','select') as anon_read,
    has_table_privilege('authenticated','public.dmcrm_site_photos','update') as browser_write,
    (select relrowsecurity from pg_class where oid='public.dmcrm_site_photos'::regclass) as rls,
    (select public from storage.buckets where id='dmcrm-gallery') as bucket_public`);
  const check = rows[0];
  if (
    check.anon_read ||
    check.browser_write ||
    !check.rls ||
    check.bucket_public !== false
  )
    throw new Error("Customer gallery privacy checks failed");
  await client.query("savepoint gallery_release_fixture");
  try {
    const id = "d9a11000-0000-4000-8000-000000009999";
    const org = "d5a1c100-0000-4000-8000-000000000001";
    await client.query(
      `insert into dmcrm_site_photos(id,org_id,storage_path,alt,published)
      values($1::uuid,$2::uuid,($2::uuid)::text||'/'||($1::uuid)::text||'.webp','Gallery release fixture',false)`,
      [id, org],
    );
    const { rows: hidden } = await client.query(
      "select id from dmcrm_site_photos where id=$1 and published",
      [id],
    );
    if (hidden.length) throw new Error("Gallery draft exposed");
    const { rows: otherOrg } = await client.query(
      "update dmcrm_site_photos set published=true where id=$1 and org_id<>$2 returning id",
      [id, org],
    );
    if (otherOrg.length)
      throw new Error("Gallery organization isolation failed");
  } finally {
    await client.query("rollback to savepoint gallery_release_fixture");
  }
}
