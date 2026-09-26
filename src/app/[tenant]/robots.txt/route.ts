import { getSite, siteOrigin } from '@/features/tenant/server';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { NOINDEX_PREFIXES } from '@/lib/routes';

/** Per-tenant robots.txt. Tenants that turn off indexing (or haven't launched) block everything. */
/**
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/robots.txt'>) {
  const site = await getSite((await params).tenant);
  const lines = site.seo.indexable
    ? [
        'User-agent: *',
        'Allow: /',
        ...NOINDEX_PREFIXES.map((p) => `Disallow: ${p}`),
        'Disallow: /api/',
        '',
        `Sitemap: ${siteOrigin(site)}/sitemap.xml`,
      ]
    : ['User-agent: *', 'Disallow: /'];
  return new Response(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CDN_CACHE } });
}
