import 'server-only';
import { cache } from 'react';
import { ApiError } from '@/lib/api/errors';
import { apiGet, cacheTags } from '@/lib/api/server';
import { pageGateOf } from './gates';
import { normalizePage } from './normalize';
import type { Page, PageGate } from './types';

/** The result of reading a builder page for this request. */
export type PageResult =
  | { status: 'ok'; page: Page }
  | { status: 'not_found' }
  /** Password and members-only pages: the shared (cached) render shows the gate; the browser takes it from there. */
  | { status: 'gated'; gate: PageGate; title: string | null };

/** Page path grammar (docs/api/pages.md): lower-case `[a-z0-9-]` segments joined by `/`, ≤ 200 characters. */
export const isPageSlug = (slug: string) => slug.length <= 200 && /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(slug);

/**
 * A site-builder page by API slug (`home`, `about`, `about/team`). Tagged with every builder page, the page itself,
 * the catalogue and membership, since sections embed resolved courses, plans and stats.
 */
export const getPage = cache(async (tenant: string, slug: string, locale?: string): Promise<PageResult> => {
  if (slug !== 'home' && !isPageSlug(slug)) return { status: 'not_found' };
  try {
    const page = await apiGet<Page>(tenant, `/pages/${slug.split('/').map(encodeURIComponent).join('/')}`, {
      tags: [cacheTags.pages(tenant), cacheTags.catalog(tenant), cacheTags.membership(tenant)],
      locale,
    });
    // An older or partial (cached) payload renders with safe defaults instead of failing the page.
    return { status: 'ok', page: normalizePage(page) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { status: 'not_found' };
    const gate = pageGateOf(e);
    if (gate) return { status: 'gated', gate, title: e instanceof ApiError ? e.title : null };
    throw e;
  }
});
