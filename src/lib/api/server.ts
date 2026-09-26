import 'server-only';
import { env } from '@/config/env';
import { camelize } from './case';
import { ApiError } from './errors';
import type { Resource } from './types';

/**
 * Server-to-server reads from Server Components. Responses land in Next's Data Cache tagged per tenant, so a
 * `/hooks/revalidate` call from Laravel refreshes exactly the pages that used the data. Never reads cookies: public
 * pages stay static. Learner-specific data is fetched in the browser (lib/api/client.ts).
 */

/** Cache tags. Laravel sends these to /hooks/revalidate when content changes. */
export const cacheTags = {
  tenant: (t: string) => `t:${t}`,
  site: (t: string) => `t:${t}:site`,
  catalog: (t: string) => `t:${t}:catalog`,
  course: (t: string, slug: string) => `t:${t}:course:${slug}`,
  page: (t: string, slug: string) => `t:${t}:page:${slug}`,
  membership: (t: string) => `t:${t}:membership`,
  content: (t: string) => `t:${t}:content`,
} as const;

/** Safety net: even without a webhook, cached data is at most this old (seconds). */
const DEFAULT_REVALIDATE = 3600;

interface GetOptions {
  tags?: string[];
  revalidate?: number;
}

export async function apiGet<T>(tenant: string, path: string, { tags = [], revalidate = DEFAULT_REVALIDATE }: GetOptions = {}): Promise<T> {
  const res = await fetch(`${env.API_URL}/api/v1${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${env.API_SERVICE_TOKEN}`, 'X-Tenant': tenant },
    next: { revalidate, tags: [cacheTags.tenant(tenant), ...tags] },
  });
  if (!res.ok) throw await ApiError.from(res);
  return camelize<Resource<T>>(await res.json()).data;
}

/** Like apiGet, but a 404 becomes `null` so the page can call `notFound()`. */
export async function apiGetOrNull<T>(tenant: string, path: string, opts?: GetOptions): Promise<T | null> {
  try {
    return await apiGet<T>(tenant, path, opts);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
