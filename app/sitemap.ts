import type { MetadataRoute } from 'next';
import {publicInventory} from '../lib/backend';
export const dynamic = 'force-dynamic';

const routes = ['', '/inventory', '/sell-your-car', '/apply', '/about', '/about/staff', '/about/employment', '/contact', '/payments', '/privacy-policy'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const vehicles = await publicInventory('available,pending,sold');
  return [...routes.map((route) => ({
    url: `https://www.drivemaxusedcars.com${route}`,
    changeFrequency: route === '/inventory' ? 'weekly' as const : 'monthly' as const,
    priority: route === '' ? 1 : route === '/inventory' ? 0.9 : 0.7,
  })), ...vehicles.map(v=>({url:`https://www.drivemaxusedcars.com/inventory/${v.slug}`,lastModified:v.updated_at,changeFrequency:'weekly' as const,priority:v.status==='sold'?0.4:0.8}))];
}
