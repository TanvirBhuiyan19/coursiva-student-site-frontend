import { Hono } from 'hono';
import { pathKey, resolveRedirect } from '@/features/seo/rules';
import { type Env, type AppContext } from '../lib/db';
import { body, invalid, noContent, ok, str } from '../lib/http';

/**
 * The school's SEO on the storefront (Laravel PublicSeoController; docs/api/pages.md → SEO):
 * `GET /seo` (settings, per-page overrides, sitemap URLs), the proxy's redirect table and hit counter (service token),
 * and the 404 page's report.
 */
export const seoRoutes = new Hono<Env>();

const SERVICE_TOKEN = process.env.API_SERVICE_TOKEN ?? 'dev-service-token';
const TYPES = ['organization', 'course', 'product', 'breadcrumbs', 'faq', 'article', 'person'] as const;
const BOTS = /bot\b|bot\/|crawl|spider|slurp|curl|wget|python|headless|lighthouse/i;

const seoOf = (c: AppContext) => (c.get('t').seo ??= {});

seoRoutes.get('/seo', (c: AppContext) => {
  const t = c.get('t');
  const s = seoOf(c);
  const noindex = s.noindex ?? false;
  return ok(c, {
    titleTemplate: s.titleTemplate ?? '{page} — {school}',
    noindex,
    schemaEnabled: s.schemaEnabled ?? true,
    schemaTypes: Object.fromEntries(TYPES.map((k) => [k, s.schemaTypes?.[k] !== false])),
    autoOgImages: false,
    cookieConsent: true,
    robotsTxt: noindex
      ? 'User-agent: *\nDisallow: /'
      : (s.robotsTxt ?? 'User-agent: *\nAllow: /\nDisallow: /checkout\nSitemap: /sitemap.xml'),
    headScripts: '',
    trackers: [],
    // Laravel lists the live site's pages, the catalogue, products, blog posts, instructors and help articles.
    sitemap: noindex
      ? []
      : [
          ...t.courses.map((x) => ({ path: `/courses/${x.slug}`, updatedAt: null })),
          ...(t.products ?? []).map((p) => ({ path: `/products/${p.slug}`, updatedAt: null })),
        ],
    pages: (s.pages ?? []).map((p) => ({
      path: p.path,
      title: p.title ?? null,
      description: p.description ?? null,
      noindex: p.noindex ?? false,
      inSitemap: p.inSitemap ?? true,
      canonicalUrl: p.canonicalUrl ?? null,
      ogImageUrl: p.ogImageUrl ?? null,
    })),
  });
});

const service = (c: AppContext) => c.req.header('authorization') === `Bearer ${SERVICE_TOKEN}`;

/** The proxy's table (service token; Laravel: oldest first, at most 5,000). */
seoRoutes.get('/seo/redirects', (c: AppContext) => {
  if (!service(c)) return c.json({ message: 'Unauthenticated.' }, 401);
  return ok(
    c,
    (seoOf(c).redirects ?? []).map(({ id, from, to, status, keepQuery }) => ({ id, from, to, status, keepQuery })),
  );
});

seoRoutes.post('/seo/redirects/:id/hits', (c: AppContext) => {
  if (!service(c)) return c.json({ message: 'Unauthenticated.' }, 401);
  const r = (seoOf(c).redirects ?? []).find((x) => x.id === c.req.param('id'));
  if (r) r.hits++;
  return noContent(c);
});

/**
 * A 404 the site's server served (service token; never a browser): bots and covered paths are ignored, the query string
 * dropped, an outside referrer's host kept (an in-app visit, `internal`, keeps none).
 */
seoRoutes.post('/seo/not-found', async (c: AppContext) => {
  if (!service(c)) return c.json({ message: 'Unauthenticated.' }, 401);
  const b = await body<{ path: string; referrer: string | null; internal?: boolean; visitorIp: string; userAgent?: string }>(c);
  const path = str(b.path);
  if (!path.startsWith('/') || path.length > 2000) return invalid(c, { path: 'The path field format is invalid.' });
  if (!str(b.visitorIp)) return invalid(c, { visitor_ip: 'The visitor ip field is required.' });
  const s = seoOf(c);
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  if (BOTS.test(str(b.userAgent)) || resolveRedirect(s.redirects ?? [], clean)) return noContent(c);
  let host: string | null = null;
  try {
    host = b.referrer && !b.internal ? new URL(b.referrer).hostname.toLowerCase() : null;
  } catch {
    host = null;
  }
  const rows = (s.notFound ??= []);
  const row = rows.find((r) => pathKey(r.path) === pathKey(clean));
  if (row) {
    row.hits++;
    if (host) row.referrerHost = host;
    if (b.internal) row.internalHits = (row.internalHits ?? 0) + 1;
  } else rows.push({ path: clean, referrerHost: host, hits: 1, ...(b.internal ? { internalHits: 1 } : {}) });
  return noContent(c);
});

/** Test hook (`GET /__mock/seo` with `X-Tenant`): the 404 monitor's rows and the redirects' hit counts. Never in the real API. */
export const seoHook = (c: AppContext) => ok(c, { notFound: seoOf(c).notFound ?? [], redirects: seoOf(c).redirects ?? [] });
