import 'server-only';
import { env } from '@/config/env';
import { camelize } from '@/lib/api/case';
import type { Resource } from '@/lib/api/types';
import type { TenantResolution } from './types';

/**
 * Host → tenant, used by the proxy on every request. Proxy can't use Next's Data Cache, so results are memoised
 * in-process for a minute (misses for 30s). A domain change in the dashboard therefore takes ≤60s to apply.
 */
const TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const memo = new Map<string, { value: TenantResolution | null; expires: number }>();

/** Plain localhost has no subdomain; in development it serves DEV_DEFAULT_TENANT without a canonical redirect. */
export const isBareDevHost = (host: string) => env.isDev && (host === 'localhost' || host === '127.0.0.1');

export async function resolveTenant(host: string): Promise<TenantResolution | null> {
  const lookup = isBareDevHost(host) && env.DEV_DEFAULT_TENANT ? `${env.DEV_DEFAULT_TENANT}.${env.PLATFORM_ROOT_DOMAIN}` : host;
  const hit = memo.get(lookup);
  if (hit && hit.expires > Date.now()) return hit.value;

  const res = await fetch(`${env.API_URL}/platform/v1/domains/resolve?host=${encodeURIComponent(lookup)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${env.API_SERVICE_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) throw new Error(`Tenant resolution failed for ${lookup}: HTTP ${res.status}`);
  const value = res.ok ? camelize<Resource<TenantResolution>>(await res.json()).data : null;

  if (memo.size >= MAX_ENTRIES) memo.delete(memo.keys().next().value!);
  memo.set(lookup, { value, expires: Date.now() + (value ? TTL_MS : MISS_TTL_MS) });
  return value;
}

/** Hosts listed in NOINDEX_HOSTS (staging, previews) always send `X-Robots-Tag: noindex`. */
export function isNoindexHost(host: string): boolean {
  return env.noindexHosts.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern));
}
