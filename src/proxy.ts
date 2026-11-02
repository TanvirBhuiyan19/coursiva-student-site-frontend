import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';
import { clientIp, isPageView, isPrefetchRequest, pageViewPath, pageViewReferrer, reportPageView } from '@/features/analytics/pageviews';
import { noteVisit, visitOf, visitorOf } from '@/features/seo/notFound';
import { edgeRedirect, reportRedirectHit } from '@/features/seo/redirects';
import { isBareDevHost, isNoindexHost, resolveTenant } from '@/features/tenant/resolve';
import { splitLocale } from '@/i18n/locales';
import { isPrivatePath, isReservedRedirectPath, routes } from '@/lib/routes';
import { isPreviewPath, previewHeaders } from '@/lib/securityHeaders';
import { shortLinkApiPath } from '@/lib/shortLinks';

// `/embed/forms.js`: the lead-form embed script (src/features/forms/embedScript.ts), one per host like the rest.
const TENANT_FILES = new Set(['/sitemap.xml', '/robots.txt', '/icon.png', '/embed/forms.js']);
/** Public path of the personal-rendering switch (not a valid builder slug, so it never collides with a page). */
const SITE_SESSION = '/__site';
/** Public path the 404 page reports its miss to (src/app/[tenant]/not-found-report; not a valid builder slug either). */
const NOT_FOUND_REPORT = '/__404';

/**
 * Every request to the learner site passes through here:
 *  1. Resolve the Host to a tenant (subdomain of the platform root or a custom domain). Unknown → 404.
 *  2. Canonical host: other hosts for the same tenant 308 to its primary host (one URL per page for SEO).
 *  3. `/api/*` and `/sanctum/*` stream to Laravel with the tenant attached, so the session cookie stays first-party
 *     on the tenant's own domain (a Backend-for-Frontend proxy — the browser never talks to the API host).
 *  4. Guests hitting account pages go to sign-in (optimistic; the API is the real gate).
 *  5. The language comes from the URL prefix (`/es/…`, none for the default locale — see src/i18n/locales.ts).
 *  6. Everything else is rewritten to `/{tenant}/{locale}/…`, the app's root segments.
 *  7. Page views (documents and client navigations, not prefetches) are reported to the API in the background.
 *  8. The staff preview (`/preview/*`, unprefixed only): framed by the dashboard origin alone, no referrer, noindex,
 *     never counted as a page view.
 *  9. What the server saw of each page request (in-app or not, the external referrer) is noted for the 404 monitor,
 *     whose report the 404 page asks this server to make (src/features/seo/notFound.ts).
 */
export async function proxy(req: NextRequest, event?: NextFetchEvent) {
  // Only the Host header decides the tenant. A client-supplied X-Forwarded-Host must not, or one tenant's pages could
  // be served (and CDN-cached) under another tenant's hostname. The edge in front of us must preserve Host.
  const hostHeader = (req.headers.get('host') ?? '').trim().toLowerCase();
  const host = hostHeader.replace(/:\d+$/, '');
  const { pathname, search } = req.nextUrl;

  const tenant = await resolveTenant(host);
  if (!tenant) return plainPage(404, 'Site not found', 'There is no school at this address.');
  if (tenant.status === 'suspended')
    return plainPage(503, 'Temporarily unavailable', 'This school is currently unavailable. Please check back soon.');

  if (!isBareDevHost(host) && tenant.primaryHost !== host) {
    const port = hostHeader.match(/:\d+$/)?.[0] ?? '';
    const proto = tenant.primaryHost.endsWith('.localhost') ? 'http' : 'https';
    return NextResponse.redirect(
      `${proto}://${tenant.primaryHost}${tenant.primaryHost.endsWith('.localhost') ? port : ''}${pathname}${search}`,
      308,
    );
  }

  // SMS short links (`/l/{code}`) are the API's `GET /api/v1/l/{code}`: streamed like the API, its redirect untouched.
  const apiPath = pathname.startsWith('/api/') || pathname.startsWith('/sanctum/') ? pathname : shortLinkApiPath(pathname);
  if (apiPath) {
    const headers = new Headers(req.headers);
    headers.set('x-tenant', tenant.tenant);
    headers.set('x-forwarded-host', hostHeader);
    headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
    headers.delete('authorization'); // the service token is server-only; never accept one from a browser
    return NextResponse.rewrite(new URL(`${apiPath}${search}`, env.API_URL), { request: { headers } });
  }

  // Tenant-level files (one per host, not per language).
  if (TENANT_FILES.has(pathname)) return NextResponse.rewrite(new URL(`/${tenant.tenant}${pathname}${search}`, req.url));

  // Personal rendering on/off (src/app/[tenant]/site-session): previews and unlocked private sites.
  if (pathname === SITE_SESSION) return NextResponse.rewrite(new URL(`/${tenant.tenant}/site-session${search}`, req.url));
  // The 404 page's report (src/app/[tenant]/not-found-report): one per host, like the session switch.
  if (pathname === NOT_FOUND_REPORT) return NextResponse.rewrite(new URL(`/${tenant.tenant}/not-found-report`, req.url));
  // A dashboard preview link (`/any/page?preview=<token>`): open the preview, then come back without the token.
  const preview = req.nextUrl.searchParams.get('preview');
  if (preview !== null && req.method === 'GET') {
    const rest = new URL(req.url);
    rest.searchParams.delete('preview');
    const target = new URL(`/${tenant.tenant}/site-session`, req.url);
    target.searchParams.set('preview', preview);
    target.searchParams.set('next', `${pathname}${rest.search}`);
    return NextResponse.rewrite(target);
  }

  // The school's redirects (SEO → Redirects), from an in-memory table (src/features/seo/redirects.ts): one hop to the
  // final destination; served redirects are counted in the background (not prefetches). Platform, auth, token,
  // checkout and account paths are never redirected, even by a rule saved before they were reserved.
  if ((req.method === 'GET' || req.method === 'HEAD') && !isReservedRedirectPath(pathname)) {
    // A rule for `/old` also covers `/es/old`, keeping the language on a path destination.
    const lang = splitLocale(tenant, pathname);
    const redirect =
      (await edgeRedirect(tenant.tenant, pathname, search)) ??
      (lang.prefix ? await edgeRedirect(tenant.tenant, lang.rest, search, fetch, lang.prefix) : null);
    if (redirect) {
      if (!isPrefetchRequest(req.headers)) {
        const hit = reportRedirectHit(tenant.tenant, redirect.id);
        if (event) event.waitUntil(hit);
        else void hit;
      }
      return NextResponse.redirect(new URL(redirect.location, req.url), redirect.status);
    }
  }

  // Language: `/es/courses` → locale es-ES, path /courses. The default locale is unprefixed; `/en/…` redirects to it.
  const { locale, prefix, rest, defaultPrefixed } = splitLocale(tenant, pathname);
  if (defaultPrefixed) return NextResponse.redirect(new URL(`${rest}${search}`, req.url), 308);
  // `/home` is the site-builder home page, served at `/`: one URL per page.
  if (rest === '/home') return NextResponse.redirect(new URL(`${prefix || '/'}${search}`, req.url), 308);
  // 8. The staff preview lives at one URL per token, in the school's default language.
  const staffPreview = isPreviewPath(rest);
  if (staffPreview && prefix) return NextResponse.redirect(new URL(`${rest}${search}`, req.url), 308);

  if (isPrivatePath(rest) && !req.cookies.has(env.SESSION_COOKIE)) {
    // `next` is a locale-less app path; the sign-in page stays in the visitor's language.
    return NextResponse.redirect(new URL(`${prefix}${routes.signIn(`${rest}${search}`)}`, req.url));
  }

  // 9. Note where this page request came from, should it turn out to be a 404 (prefetches too: a prefetched page needs
  // no request when clicked). Only in this process's memory, for a few minutes.
  if (!staffPreview && (isPageView(req.method, pathname, req.headers) || (req.method === 'GET' && req.headers.get('rsc') === '1'))) {
    const ip = clientIp(req.headers);
    if (ip) noteVisit(tenant.tenant, visitorOf(ip, req.headers.get('user-agent') ?? ''), pathname, visitOf(req.headers, host));
  }

  // 7. Count the page view server-side, in the background (src/features/analytics/pageviews.ts).
  if (env.ANALYTICS_PAGEVIEWS === 'on' && !staffPreview && isPageView(req.method, pathname, req.headers)) {
    const path = pageViewPath(rest, search);
    const visitorIp = clientIp(req.headers);
    if (path && visitorIp) {
      const report = reportPageView({
        apiUrl: env.API_URL,
        serviceToken: env.API_SERVICE_TOKEN,
        tenant: tenant.tenant,
        path,
        visitorIp,
        userAgent: req.headers.get('user-agent') ?? '',
        referrer: pageViewReferrer(req.headers, host),
      });
      if (event) event.waitUntil(report);
      else void report;
    }
  }

  const res = NextResponse.rewrite(new URL(`/${tenant.tenant}/${locale}${rest === '/' ? '' : rest}${search}`, req.url));
  res.headers.set('Content-Language', locale);
  if (!tenant.indexable || isNoindexHost(host)) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Overrides next.config's page headers (the proxy's response headers win): only the dashboard may frame a preview.
  if (staffPreview) for (const h of previewHeaders(env.dashboardOrigins)) res.headers.set(h.key, h.value);
  return res;
}

export const config = {
  // Static build output, image optimisation and the revalidation webhook skip the proxy.
  matcher: ['/((?!_next/static|_next/image|hooks/).*)'],
};

function plainPage(status: number, title: string, body: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#333"><main style="text-align:center;padding:24px"><h1 style="font-size:24px">${title}</h1><p>${body}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(status === 503 ? { 'retry-after': '3600' } : {}),
    },
  });
}
