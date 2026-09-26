import 'server-only';
import { cache } from 'react';
import { apiGet, apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { Catalog, CourseDetail } from './types';

export const getCatalog = cache((tenant: string, locale?: string) =>
  apiGet<Catalog>(tenant, '/courses', { tags: [cacheTags.catalog(tenant)], locale }),
);

export const getCourse = cache((tenant: string, slug: string, locale?: string) =>
  apiGetOrNull<CourseDetail>(tenant, `/courses/${encodeURIComponent(slug)}`, {
    tags: [cacheTags.catalog(tenant), cacheTags.course(tenant, slug)],
    locale,
  }),
);
