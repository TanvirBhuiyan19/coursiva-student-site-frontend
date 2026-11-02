import 'server-only';
import { env } from '@/config/env';
import { notFound } from 'next/navigation';
import { camelize } from './case';
import { ApiError } from './errors';
import { personalContext } from './personal';
import type { Paginated, Resource } from './types';

/**
 * Server-to-server reads from Server Components. Responses land in Next's Data Cache tagged per tenant, so a
 * `/hooks/revalidate` call from Laravel refreshes exactly the pages that used the data. Never reads cookies: public
 * pages stay static. Learner-specific data is fetched in the browser (lib/api/client.ts). The exception is personal
 * rendering (a dashboard preview, an unlocked private site — see ./personal.ts): reads are then uncached and carry
 * the visitor's cookies and preview token.
 */

/** Cache tags. Laravel sends these to /hooks/revalidate when content changes. */
export const cacheTags = {
  tenant: (t: string) => `t:${t}`,
  site: (t: string) => `t:${t}:site`,
  catalog: (t: string) => `t:${t}:catalog`,
  course: (t: string, slug: string) => `t:${t}:course:${slug}`,
  /** A product's sales page (`/products/{slug}`); Laravel sends it with `catalog` on every product change. */
  product: (t: string, slug: string) => `t:${t}:product:${slug}`,
  /** Every site-builder page (publishes, learner feedback and category edits revalidate it; there is no per-page tag). */
  pages: (t: string) => `t:${t}:pages`,
  membership: (t: string) => `t:${t}:membership`,
  /** Help centre and legal pages (Laravel sends it when the school's contact details change). */
  content: (t: string) => `t:${t}:content`,
  /** The blog (list and posts). */
  blog: (t: string) => `t:${t}:blog`,
  /**
   * Instructor profiles: the index and every profile page (Laravel also sends it on every course change — profiles list
   * and count courses).
   */
  instructors: (t: string) => `t:${t}:instructors`,
  /** One instructor profile (Laravel sends the old and the new slug on a rename). */
  instructor: (t: string, slug: string) => `t:${t}:instructor:${slug}`,
  /** A public webinar's page (`/webinars/{slug}`); kept for 60 s at most, its seats and form token are read live. */
  webinar: (t: string, slug: string) => `t:${t}:webinar:${slug}`,
} as const;

/**
 * The API payload shape this build renders. Sent on every server read, so it is part of Next's Data Cache key
 * (request headers are): a deploy that changes the shape doesn't serve responses cached by the previous build.
 * Bump it with every breaking payload change (normalizeSite / normalizePage still guard partial payloads).
 */
export const PAYLOAD_VERSION = '2026-10-19.instructors';

/** Safety net: even without a webhook, cached data is at most this old (seconds). */
const DEFAULT_REVALIDATE = 3600;

interface GetOptions {
  tags?: string[];
  revalidate?: number;
  /**
   * Content language. Sent as `?locale=` (part of the cache key, so each language is cached separately) and as
   * `Accept-Language`. Omitted = the tenant's default language.
   */
  locale?: string | undefined;
}

export async function apiGet<T>(tenant: string, path: string, opts: GetOptions = {}): Promise<T> {
  return (await apiRead<Resource<T>>(tenant, path, opts)).data;
}

/** A paginated list (`{ data, meta }`), e.g. the blog. */
export function apiGetPage<T>(tenant: string, path: string, opts: GetOptions = {}): Promise<Paginated<T>> {
  return apiRead<Paginated<T>>(tenant, path, opts);
}

async function apiRead<B>(
  tenant: string,
  path: string,
  { tags = [], revalidate = DEFAULT_REVALIDATE, locale }: GetOptions = {},
): Promise<B> {
  const url = new URL(`${env.API_URL}/api/v1${path}`);
  if (locale) url.searchParams.set('locale', locale);
  const personal = await personalContext();
  if (personal?.preview) url.searchParams.set('preview', personal.preview);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.API_SERVICE_TOKEN}`,
      'X-Tenant': tenant,
      'X-Storefront-Payload': PAYLOAD_VERSION,
      ...(locale ? { 'Accept-Language': locale } : {}),
      ...(personal?.cookie ? { Cookie: personal.cookie } : {}),
    },
    ...(personal ? { cache: 'no-store' as const } : { next: { revalidate, tags: [cacheTags.tenant(tenant), ...tags] } }),
  });
  if (!res.ok) {
    const error = await ApiError.from(res);
    // A locked site: the layout shows the lock screen instead of the page (features/site-lock), so the page itself
    // is "not found" for this visitor — never an error page.
    if (error.status === 401 && error.code === 'site_locked') notFound();
    throw error;
  }
  return camelize<B>(await res.json());
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
