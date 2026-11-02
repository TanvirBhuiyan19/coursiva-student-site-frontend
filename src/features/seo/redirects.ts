import 'server-only';
import { env } from '@/config/env';
import { camelize } from '@/lib/api/case';
import type { Resource } from '@/lib/api/types';
import { indexRedirects, redirectLocation, resolveRedirect, type RedirectIndex } from './rules';
import type { RedirectRule } from './types';

/**
 * The school's redirect table for the proxy (docs/api/pages.md → SEO → Redirects), indexed once per load. The proxy
 * can't use Next's Data Cache, so each tenant's table is held in memory:
 *
 * - **Fresh for a minute**, then served stale while one request refreshes it in the background (no request waits).
 * - **After a change** Laravel revalidates the tenant (`/hooks/revalidate` with `t:<slug>` calls `forgetRedirects`):
 *   the next request waits for the new table.
 * - **A failed refresh keeps the last good table** (retried after 30 seconds): a slow or failing API never drops the
 *   school's redirects. Without any table yet — or with an older API (no endpoint, 404) — there are no redirects,
 *   never a broken page.
 */
const TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_TENANTS = 2_000;
type Table = RedirectIndex<RedirectRule>;
const EMPTY: Table = indexRedirects<RedirectRule>([]);
// On globalThis: the proxy and the revalidation route are separate bundles in one Node process, and must share it.
type Memo = Map<string, { table: Table; expires: number; changed?: boolean }>;
const shared = globalThis as typeof globalThis & { __coursivaRedirects?: Memo };
const memo: Memo = (shared.__coursivaRedirects ??= new Map() as Memo);
const inflight = new Map<string, Promise<Table>>();

/** A tenant's redirects changed: the next request loads them (the old table stays only as the fallback). No tenant: forget all. */
export function forgetRedirects(tenant?: string) {
  if (tenant === undefined) memo.clear();
  else {
    const hit = memo.get(tenant);
    if (hit) memo.set(tenant, { table: hit.table, expires: 0, changed: true });
  }
}

export async function redirectTable(tenant: string, fetchImpl: typeof fetch = fetch): Promise<Table> {
  const hit = memo.get(tenant);
  if (hit && hit.expires > Date.now()) return hit.table;
  const load = inflight.get(tenant) ?? refresh(tenant, fetchImpl, hit?.table);
  return hit && !hit.changed ? hit.table : load;
}

function refresh(tenant: string, fetchImpl: typeof fetch, last: Table | undefined): Promise<Table> {
  const load = (async () => {
    let table = last ?? EMPTY;
    let ttl = MISS_TTL_MS;
    try {
      const res = await fetchImpl(`${env.API_URL}/api/v1/seo/redirects`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${env.API_SERVICE_TOKEN}`, 'X-Tenant': tenant },
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        table = indexRedirects(camelize<Resource<RedirectRule[]>>(await res.json()).data.filter(isRule));
        ttl = TTL_MS;
      } else if (res.status === 404) table = EMPTY;
    } catch {
      // Keep the last good table; retry later.
    }
    if (!memo.has(tenant) && memo.size >= MAX_TENANTS) memo.delete(memo.keys().next().value!);
    memo.set(tenant, { table, expires: Date.now() + ttl });
    return table;
  })().finally(() => inflight.delete(tenant));
  inflight.set(tenant, load);
  return load;
}

const isRule = (r: unknown): r is RedirectRule =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as RedirectRule).id === 'string' &&
  typeof (r as RedirectRule).from === 'string' &&
  typeof (r as RedirectRule).to === 'string';

/** Counts a redirect the proxy served. Fire-and-forget: never rejects, gives up after 1.5 s. */
export async function reportRedirectHit(tenant: string, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${env.API_URL}/api/v1/seo/redirects/${encodeURIComponent(id)}/hits`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${env.API_SERVICE_TOKEN}`, 'X-Tenant': tenant },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // An uncounted hit is not an error.
  }
}

/**
 * The redirect the proxy serves for a request, if any: the school's rule for the path (exact, else the longest prefix),
 * chains followed to the final destination (one hop for the visitor), the visitor's query kept when the rule says so.
 * `location` is a site path or an absolute URL. With a language prefix (`/es`), `pathname` is the path after it and a
 * path destination keeps the prefix (`/es/old` → `/es/new`).
 */
export async function edgeRedirect(
  tenant: string,
  pathname: string,
  search: string,
  fetchImpl: typeof fetch = fetch,
  localePrefix = '',
): Promise<{ location: string; status: 301 | 302; id: string } | null> {
  const table = await redirectTable(tenant, fetchImpl);
  if (table.rules.length === 0) return null;
  const hit = resolveRedirect(table, pathname);
  if (!hit) return null;
  const to = localePrefix && hit.to.startsWith('/') ? `${localePrefix}${hit.to === '/' ? '' : hit.to}` : hit.to;
  return { location: redirectLocation(to, search, hit.keepQuery), status: hit.status, id: hit.rule.id };
}
