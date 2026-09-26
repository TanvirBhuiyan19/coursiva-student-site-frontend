import { getCatalog } from '@/features/catalog/server';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { getSite, siteOrigin } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';
import { routes } from '@/lib/routes';

/**
 * Per-tenant sitemap at `/sitemap.xml`: every indexable public page, in every language the tenant publishes, on the
 * canonical host. With more than one language each entry lists its translations (`xhtml:link hreflang`) plus an
 * x-default, as Google recommends. Revalidated with the catalogue (`t:<slug>:catalog`).
 */
/**
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

const xmlEscape = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/sitemap.xml'>) {
  const { tenant } = await params;
  const [site, catalog] = await Promise.all([getSite(tenant), getCatalog(tenant)]);
  const origin = siteOrigin(site);
  const latest = catalog.courses
    .map((c) => c.updatedAt)
    .sort()
    .at(-1);

  const entries: { path: string; priority: number; changefreq: string; lastmod?: string }[] = site.seo.indexable
    ? [
        { path: routes.home, priority: 1, changefreq: 'weekly', lastmod: latest },
        { path: routes.courses, priority: 0.9, changefreq: 'weekly', lastmod: latest },
        ...catalog.courses.map((c) => ({ path: routes.course(c.slug), priority: 0.8, changefreq: 'weekly', lastmod: c.updatedAt })),
        ...(site.features.membership ? [{ path: routes.membership, priority: 0.7, changefreq: 'monthly' }] : []),
        { path: routes.help, priority: 0.4, changefreq: 'monthly' },
        { path: routes.contact, priority: 0.3, changefreq: 'yearly' },
        { path: routes.refund, priority: 0.2, changefreq: 'yearly' },
        { path: routes.privacy, priority: 0.2, changefreq: 'yearly' },
        { path: routes.terms, priority: 0.2, changefreq: 'yearly' },
      ]
    : [];

  const abs = (locale: string, path: string) => {
    const p = localizePath(site, locale, path);
    return xmlEscape(`${origin}${p === '/' ? '' : p}`);
  };
  const multi = site.locales.length > 1;
  const body = entries
    .flatMap((e) =>
      site.locales.map((locale) => {
        const links = multi
          ? [
              ...site.locales.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(l, e.path)}"/>`),
              `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(site.defaultLocale, e.path)}"/>`,
            ].join('')
          : '';
        return `<url><loc>${abs(locale, e.path)}</loc>${links}${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<changefreq>${e.changefreq}</changefreq><priority>${e.priority.toFixed(1)}</priority></url>`;
      }),
    )
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${multi ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>${body}</urlset>`,
    {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': CDN_CACHE },
    },
  );
}
