import { photoUrl, publicInventory } from "../lib/backend";
import { buildSitemap } from "../lib/seo";
export const dynamic = "force-dynamic";

export default async function sitemap() {
  return buildSitemap(
    await publicInventory("available,pending,sold"),
    photoUrl,
  );
}
