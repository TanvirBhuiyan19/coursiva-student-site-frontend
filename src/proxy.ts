import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';
import { isBareDevHost, isNoindexHost, resolveTenant } from '@/features/tenant/resolve';
import { splitLocale } from '@/i18n/locales';
import { isPrivatePath, routes } from '@/lib/routes';

const TENANT_FILES = new Set(['/sitemap.xml', '/robots.txt', '/icon.png']);

/**
 * Every request to the learner site passes through here:
 *  1. Resolve the Host to a tenant (subdomain of the platform root or a custom domain). Unknown → 404.
 *  2. Canonical host: other hosts for the same tenant 308 to its primary host (one URL per page for SEO).
 *  3. `/api/*` and `/sanctum/*` stream to Laravel with the tenant attached, so the session cookie stays first-party
 *     on the tenant's own domain (a Backend-for-Frontend proxy — the browser never talks to the API host).
 *  4. Guests hitting account pages go to sign-in (optimistic; the API is the real gate).
 *  5. The language comes from the URL prefix (`/es/…`, none for the default locale — see src/i18n/locales.ts).
 *  6. Everything else is rewritten to `/{tenant}/{locale}/…`, the app's root segments.
 */
export async function proxy(req: NextRequest) {
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

  if (pathname.startsWith('/api/') || pathname.startsWith('/sanctum/')) {
    const headers = new Headers(req.headers);
    headers.set('x-tenant', tenant.tenant);
    headers.set('x-forwarded-host', hostHeader);
    headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
    headers.delete('authorization'); // the service token is server-only; never accept one from a browser
    return NextResponse.rewrite(new URL(`${pathname}${search}`, env.API_URL), { request: { headers } });
  }

  // Tenant-level files (one per host, not per language).
  if (TENANT_FILES.has(pathname)) return NextResponse.rewrite(new URL(`/${tenant.tenant}${pathname}${search}`, req.url));

  // Language: `/es/courses` → locale es-ES, path /courses. The default locale is unprefixed; `/en/…` redirects to it.
  const { locale, prefix, rest, defaultPrefixed } = splitLocale(tenant, pathname);
  if (defaultPrefixed) return NextResponse.redirect(new URL(`${rest}${search}`, req.url), 308);

  if (isPrivatePath(rest) && !req.cookies.has('coursiva_session')) {
    // `next` is a locale-less app path; the sign-in page stays in the visitor's language.
    return NextResponse.redirect(new URL(`${prefix}${routes.signIn(`${rest}${search}`)}`, req.url));
  }

  const res = NextResponse.rewrite(new URL(`/${tenant.tenant}/${locale}${rest === '/' ? '' : rest}${search}`, req.url));
  res.headers.set('Content-Language', locale);
  if (!tenant.indexable || isNoindexHost(host)) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
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
