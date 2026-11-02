/**
 * The 404 monitor's reports (docs/api/pages.md → SEO → 404 monitor), made by this site's server — never by a browser.
 *
 * Why not render-time: 404 pages are served from the ISR cache like any page (a catch-all miss is cached until a
 * publish), so the not-found render runs once per cache entry, not once per visit. And why not the browser alone: a
 * browser (or a script on any site) could then post any path with any "came from" claim, so a forged request could make
 * a school's own links look broken. So the two halves are split:
 *
 * 1. The proxy runs on every request, cached page or not. For each page request (documents, client navigations and
 *    router prefetches) it notes what it saw of the visit — `noteVisit` — keyed by the visitor (IP + user agent) and the
 *    path: **internal** when it is an App Router request (`RSC: 1`, only ever sent by this site's own JavaScript from one
 *    of its pages; the prefetch case matters, as a prefetched page needs no request when clicked) or when the `Referer`
 *    is this host; else the external `Referer`.
 * 2. The 404 page asks this server to report its path (`POST /__404 {path}`, same-origin only). The route handler takes
 *    the noted visit for that visitor and path (`takeVisit`), and reports it to the API with the service token
 *    (`reportNotFound`). The browser sends only the path: `internal` and the referrer are what the server saw. Without a
 *    noted visit (another server instance, or it expired) the path still counts, with no referrer and not internal.
 *
 * The memory holds no more than it needs: a few minutes, a bounded number of visits, nothing written anywhere.
 */

/** How long a noted visit waits for its 404 page's report. */
const VISIT_TTL_MS = 5 * 60_000;
const MAX_VISITS = 10_000;
/** Limits the API validates (422 otherwise). */
const MAX_PATH = 2000;
const MAX_UA = 500;
const MAX_REFERRER = 2000;

export interface NotFoundVisit {
  /** From one of this site's own pages: a client-side navigation or prefetch, or a document load referred by this host. */
  internal: boolean;
  /** The external referrer (another site), when there is one. */
  referrer: string | null;
}

/**
 * What a page request says about where the visit came from. An App Router request (`RSC: 1`) is always this site's
 * own JavaScript on one of its pages; a document load counts as internal when its `Referer` is this host.
 */
export function visitOf(headers: Headers, ownHost: string): NotFoundVisit {
  if (headers.get('rsc') === '1') return { internal: true, referrer: null };
  const raw = headers.get('referer')?.trim();
  if (!raw) return { internal: false, referrer: null };
  let ref: URL;
  try {
    ref = new URL(raw);
  } catch {
    return { internal: false, referrer: null };
  }
  if (ref.hostname.toLowerCase() === ownHost.toLowerCase()) return { internal: true, referrer: null };
  return { internal: false, referrer: raw.slice(0, MAX_REFERRER) };
}

// On globalThis: the proxy and the route handler are separate bundles in one Node process, and must share it.
type Visits = Map<string, { visit: NotFoundVisit; expires: number }>;
const shared = globalThis as typeof globalThis & { __coursivaVisits?: Visits };
const visits: Visits = (shared.__coursivaVisits ??= new Map() as Visits);

const keyOf = (tenant: string, visitor: string, path: string) => `${tenant}\n${visitor}\n${path}`;

/** The visitor, as the proxy and the route handler both see it (never stored or sent anywhere). */
export const visitorOf = (ip: string, userAgent: string) => `${ip}\n${userAgent}`;

/** The proxy noted a page request (newest wins: the latest visit of a path is the one its 404 page reports). */
export function noteVisit(tenant: string, visitor: string, path: string, visit: NotFoundVisit, now = Date.now()) {
  const key = keyOf(tenant, visitor, path);
  visits.delete(key);
  if (visits.size >= MAX_VISITS) {
    // Oldest first (insertion order): drop the expired ones, else the oldest.
    for (const [k, v] of visits) {
      if (v.expires > now && visits.size < MAX_VISITS) break;
      visits.delete(k);
    }
  }
  visits.set(key, { visit, expires: now + VISIT_TTL_MS });
}

/** The noted visit of a path, once (a second report for the same visit finds none). */
export function takeVisit(tenant: string, visitor: string, path: string, now = Date.now()): NotFoundVisit | null {
  const key = keyOf(tenant, visitor, path);
  const hit = visits.get(key);
  visits.delete(key);
  return hit && hit.expires > now ? hit.visit : null;
}

/** Tests: forget every visit. */
export function forgetVisits() {
  visits.clear();
}

/** The path a 404 page asked to report: a site path within the API's limit, never a staff preview. `null` otherwise. */
export function reportablePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > MAX_PATH) return null;
  return /^\/preview(?:\/|$)/.test(raw) ? null : raw;
}

/**
 * Only this site's own pages may ask: a browser's `Sec-Fetch-Site: same-origin`, else an `Origin` on this host. A
 * request that shows neither is not reported.
 */
export function isSameOrigin(headers: Headers, ownHost: string): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).hostname.toLowerCase() === ownHost.toLowerCase();
  } catch {
    return false;
  }
}

export interface NotFoundReport {
  apiUrl: string;
  serviceToken: string;
  tenant: string;
  path: string;
  visitorIp: string;
  userAgent: string;
  visit: NotFoundVisit | null;
}

/** Fire-and-forget: never rejects, gives up after 1.5 s, so a slow or failing API can't affect anything. */
export async function reportNotFound(r: NotFoundReport, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${r.apiUrl}/api/v1/seo/not-found`, {
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
        internal: r.visit?.internal ?? false,
        ...(r.visit?.referrer ? { referrer: r.visit.referrer } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // An unreported 404 is not an error.
  }
}
