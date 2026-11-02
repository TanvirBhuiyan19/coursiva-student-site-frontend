import { getHelp } from '@/features/account/server';
import { getCatalog } from '@/features/catalog/server';
import { getAllInstructors } from '@/features/instructors/server';
import { ApiError } from '@/lib/api/errors';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { getSite, siteOrigin } from '@/features/tenant/server';
import { unlisted } from '@/features/seo/normalize';
import { pathKey } from '@/features/seo/rules';
import { getSeo } from '@/features/seo/server';
import { localizePath } from '@/i18n/locales';
import { isNoindexPath, routes } from '@/lib/routes';

/**
 * Per-tenant sitemap at `/sitemap.xml`: every indexable public page, in every language the tenant publishes, on the
 * canonical host. With more than one language each entry lists its translations (`xhtml:link hreflang`) plus an
 * x-default, as Google recommends. Revalidated with the catalogue (`t:<slug>:catalog`), the instructor profiles
 * (`t:<slug>:instructors`) and the help centre (`t:<slug>:content`).
 */
/**
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

/** First path segments the app's own screens own (`src/app/[tenant]/[locale]/*`, plus the builder's aliases). */
const BUILT_IN = new Set([
  'account',
  'cart',
  'certificates',
  'checkout',
  'community',
  'contact',
  'courses',
  'forgot-password',
  'help',
  'instructors',
  'learn',
  'learning',
  'membership',
  'orders',
  'privacy',
  'refund-policy',
  'sign-in',
  'sign-up',
  'terms',
  'wishlist',
  'login',
  'signup',
  'profile',
]);

const xmlEscape = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/sitemap.xml'>) {
  const { tenant } = await params;
  const [site, seo, catalog, instructors, help] = await Promise.all([
    getSite(tenant),
    getSeo(tenant),
    getCatalog(tenant),
    // An API without instructor profiles yet (404) just lists none.
    getAllInstructors(tenant).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }),
    // Help articles (docs/api/account.md → Help centre); the sitemap never fails on them.
    getHelp(tenant).catch(() => []),
  ]);
  const origin = siteOrigin(site);
  const latest = catalog.courses
    .map((c) => c.updatedAt)
    .sort()
    .at(-1);

  const listed: { path: string; priority: number; changefreq: string; lastmod?: string }[] =
    site.seo.indexable && !seo.noindex
      ? [
          { path: routes.home, priority: 1, changefreq: 'weekly', lastmod: latest },
          { path: routes.courses, priority: 0.9, changefreq: 'weekly', lastmod: latest },
          ...catalog.courses.map((c) => ({ path: routes.course(c.slug), priority: 0.8, changefreq: 'weekly', lastmod: c.updatedAt })),
          ...(site.features.membership ? [{ path: routes.membership, priority: 0.7, changefreq: 'monthly' }] : []),
          // Instructor profiles (docs/api/instructors.md): the index only while at least one profile is visible.
          ...(instructors.length > 0 ? [{ path: routes.instructors, priority: 0.6, changefreq: 'weekly' }] : []),
          ...instructors.map((p) => ({ path: routes.instructor(p.slug), priority: 0.6, changefreq: 'monthly' })),
          { path: routes.help, priority: 0.4, changefreq: 'monthly' },
          ...help.flatMap((c) => c.articles.map((a) => ({ path: routes.helpArticle(a.slug), priority: 0.3, changefreq: 'monthly' }))),
          { path: routes.contact, priority: 0.3, changefreq: 'yearly' },
          { path: routes.refund, priority: 0.2, changefreq: 'yearly' },
          { path: routes.privacy, priority: 0.2, changefreq: 'yearly' },
          { path: routes.terms, priority: 0.2, changefreq: 'yearly' },
          // Public site-builder pages, except those at a built-in screen's path (that screen serves the URL).
          ...site.pages
            .filter((p) => !BUILT_IN.has(p.path.split('/')[1] ?? ''))
            .map((p) => ({ path: p.path, priority: 0.6, changefreq: 'monthly' })),
        ]
      : [];
  // The school's SEO: pages it hid or took out of the sitemap go; pages only the API lists (blog posts, products) are
  // added. Never a private or transactional path.
  const hidden = unlisted(seo);
  const known = new Set(listed.map((e) => pathKey(e.path)));
  const extra = listed.length
    ? seo.sitemap
        .filter((u) => /^\/(blog|products)\/[^/]+$/.test(u.path) && !known.has(pathKey(u.path)) && !isNoindexPath(pathKey(u.path)))
        .map((u) => ({
          path: u.path,
          priority: u.path.startsWith('/blog/') ? 0.5 : 0.6,
          changefreq: 'monthly',
          ...(u.updatedAt ? { lastmod: u.updatedAt } : {}),
        }))
    : [];
  const blogIndex: typeof listed = extra.some((e) => e.path.startsWith('/blog/'))
    ? [{ path: routes.blog, priority: 0.5, changefreq: 'weekly' }]
    : [];
  const entries = [...listed, ...blogIndex, ...extra].filter((e) => !hidden.has(pathKey(e.path)));

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
