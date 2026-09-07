import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow:['/control-room','/api/'] }, sitemap: 'https://www.drivemaxusedcars.com/sitemap.xml' };
}
