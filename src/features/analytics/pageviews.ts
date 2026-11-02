/**
 * Server-side page views (docs/api/README.md → "Analytics: page views"). The proxy reports each page it serves to
 * `POST /api/v1/analytics/pageviews` in the background: no browser script, no cookie, nothing to consent to. The API
 * hashes IP + user agent with a daily salt to count visitors once a day and stores neither.
 *
 * Pure helpers (no env, no Next imports) so the decision is unit-tested; the proxy wires them up.
 */

/** Paths that are never pages. Tenant files (sitemap, robots, icon) return before the proxy reaches this. */
const NOT_PAGES = /^\/(?:api|sanctum|_next|hooks)(?:\/|$)/;
/** A last segment with an extension is a file (`/favicon.ico`, `/images/x.png`), not a page. */
const FILE = /\/[^/]*\.[a-z0-9]{1,8}$/i;
/** Limits the API validates (422 otherwise). */
const MAX_PATH = 2000;
const MAX_UA = 500;
const MAX_REFERRER = 2000;

/**
 * A real page view: a GET that is a document navigation or an App Router client navigation (`RSC: 1`), never a
 * prefetch (router `<Link>` prefetches, speculation rules, browser link prefetch).
 */
export function isPageView(method: string, pathname: string, headers: Headers): boolean {
  if (method !== 'GET') return false;
  if (NOT_PAGES.test(pathname) || FILE.test(pathname)) return false;
  if (isPrefetch(headers)) return false;
  if (headers.get('rsc') === '1') return true;
  const dest = headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  return (headers.get('accept') ?? '').includes('text/html');
}

/** A router, speculation-rules or browser prefetch (not a visit). */
export const isPrefetchRequest = (headers: Headers) => isPrefetch(headers);

function isPrefetch(headers: Headers): boolean {
  return (
    headers.has('next-router-prefetch') ||
    headers.has('next-router-segment-prefetch') ||
    /prefetch|prerender/i.test(headers.get('purpose') ?? '') ||
    /prefetch|prerender/i.test(headers.get('sec-purpose') ?? '') ||
    /prefetch/i.test(headers.get('x-moz') ?? '')
  );
}

/** The locale-less app path plus its query, without Next's `_rsc` cache-buster. `null` if too long to report. */
export function pageViewPath(appPath: string, search: string): string | null {
  const params = new URLSearchParams(search);
  params.delete('_rsc');
  const query = params.toString();
  const path = `${appPath || '/'}${query ? `?${query}` : ''}`;
  return path.length <= MAX_PATH ? path : null;
}

/**
 * The view's external referrer, for the API's traffic class (direct, search, social, referral). A document load's
 * `Referer` header is the previous page; it counts only when it's another site (a referrer on the school's own host is
 * none, so it's dropped). A client-side navigation (`RSC: 1`) always comes from a page of this site, so it has none.
 * Capped at the API's 2000 characters. `null` when there is nothing to send.
 */
export function pageViewReferrer(headers: Headers, ownHost: string): string | null {
  if (headers.get('rsc') === '1') return null;
  const raw = headers.get('referer')?.trim();
  if (!raw) return null;
  let ref: URL;
  try {
    ref = new URL(raw);
  } catch {
    return null;
  }
  if (!ref.hostname || ref.hostname.toLowerCase() === ownHost.toLowerCase()) return null;
  return raw.slice(0, MAX_REFERRER);
}

/** The visitor's IP as the proxy sees it: first `X-Forwarded-For` hop, else `X-Real-IP`. `null` if none is valid. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  for (const candidate of [forwarded, headers.get('x-real-ip')]) {
    const ip = candidate ? normaliseIp(candidate) : null;
    if (ip) return ip;
  }
  return null;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function normaliseIp(raw: string): string | null {
  let ip = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip); // `[::1]:443`
  if (bracketed) ip = bracketed[1]!;
  else if (/^[\d.]+:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, ''); // `1.2.3.4:5678`
  if (IPV4.test(ip)) return ip;
  if (ip.includes(':') && /^[\da-f:.]+$/i.test(ip)) {
    try {
      // URL parsing throws for anything that isn't a valid IPv6 address.
      return new URL(`http://[${ip}]/`).hostname ? ip : null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface PageViewReport {
  apiUrl: string;
  serviceToken: string;
  tenant: string;
  path: string;
  visitorIp: string;
  userAgent: string;
  /** External referrer from `pageViewReferrer`; omitted from the body when `null`/absent. */
  referrer?: string | null;
}

/** Fire-and-forget: never rejects, gives up after 1.5 s, so a slow or failing API can't affect the page. */
export async function reportPageView(r: PageViewReport, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${r.apiUrl}/api/v1/analytics/pageviews`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${r.serviceToken}`,
        'X-Tenant': r.tenant,
      },
      body: JSON.stringify({
        path: r.path,
        visitor_ip: r.visitorIp,
        user_agent: r.userAgent.slice(0, MAX_UA),
        ...(r.referrer ? { referrer: r.referrer.slice(0, MAX_REFERRER) } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // An uncounted view is not an error.
  }
}
