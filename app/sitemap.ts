import type { MetadataRoute } from 'next';

const routes = ['', '/inventory', '/apply', '/about', '/about/staff', '/about/employment', '/contact', '/payments'];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://www.drivemaxusedcars.com${route}`,
    changeFrequency: route === '/inventory' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : route === '/inventory' ? 0.9 : 0.7,
  }));
}
