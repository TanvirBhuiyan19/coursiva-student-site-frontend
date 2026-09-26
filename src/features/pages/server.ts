import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { Page } from './types';

/** Site-builder page. Tagged with the catalogue too, since sections embed resolved courses and stats. */
export const getPage = cache((tenant: string, slug: string, locale?: string) =>
  apiGetOrNull<Page>(tenant, `/pages/${encodeURIComponent(slug)}`, {
    tags: [cacheTags.page(tenant, slug), cacheTags.catalog(tenant), cacheTags.membership(tenant)],
    locale,
  }),
);
