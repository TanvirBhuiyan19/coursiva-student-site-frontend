import { getSeo } from '@/features/seo/server';
import { getSite, siteOrigin } from '@/features/tenant/server';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { buildRobots } from '@/lib/robots';
import { NOINDEX_PREFIXES } from '@/lib/routes';

/**
 * Per-tenant robots.txt from the school's own rules (SEO → robots.txt, see lib/robots.ts). Private and transactional
 * paths (and the API) are closed in every group whatever the school writes; a school that hides its site, turns off
 * indexing or locks it blocks everything.
 *
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/robots.txt'>) {
  const { tenant } = await params;
  const [site, seo] = await Promise.all([getSite(tenant), getSeo(tenant)]);
  const body = buildRobots({
    indexable: site.seo.indexable && !seo.noindex,
    rules: seo.robotsTxt,
    privatePaths: [...NOINDEX_PREFIXES, '/api/', '/sanctum/'],
    sitemapUrl: `${siteOrigin(site)}/sitemap.xml`,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CDN_CACHE } });
}
