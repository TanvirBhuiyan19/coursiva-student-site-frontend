import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, apiGetPage, cacheTags } from '@/lib/api/server';
import type { Paginated } from '@/lib/api/types';
import type { InstructorDetail, InstructorSummary, RedirectTarget } from './types';

/** Profile slugs the API can answer (`[a-z0-9-]{1,80}`); anything else is a 404 without an API call. */
export const isInstructorSlug = (slug: string) => /^[a-z0-9-]{1,80}$/.test(slug);

/** Cards per index page (the API's default is 25, max 100). */
export const INSTRUCTORS_PER_PAGE = 24;

/** One page of published profiles, ordered by name. */
export const getInstructors = cache((tenant: string, locale?: string, page = 1): Promise<Paginated<InstructorSummary>> =>
  apiGetPage<InstructorSummary>(tenant, `/instructors?page=${page}&per_page=${INSTRUCTORS_PER_PAGE}`, {
    tags: [cacheTags.instructors(tenant)],
    locale,
  }),
);

/** Every published profile (the sitemap), 100 per request, at most 10 requests. */
export const getAllInstructors = cache(async (tenant: string): Promise<InstructorSummary[]> => {
  const out: InstructorSummary[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await apiGetPage<InstructorSummary>(tenant, `/instructors?page=${page}&per_page=100`, {
      tags: [cacheTags.instructors(tenant)],
    });
    out.push(...res.data);
    if (res.meta.currentPage >= res.meta.lastPage) break;
  }
  return out;
});

/** A published profile, or null (unknown, unpublished, hidden or a former slug — see `resolveInstructorRedirect`). */
export const getInstructor = cache((tenant: string, slug: string, locale?: string) =>
  isInstructorSlug(slug)
    ? apiGetOrNull<InstructorDetail>(tenant, `/instructors/${slug}`, {
        tags: [cacheTags.instructors(tenant), cacheTags.instructor(tenant, slug)],
        locale,
      })
    : Promise.resolve(null),
);

/**
 * Where a former profile address lives now (`GET /redirects/resolve?path=/instructors/{slug}`): the locale-less path,
 * or null when nothing claims it. Only same-site paths are followed (never an open redirect). Tagged with the old
 * slug: Laravel sends it (and the new one) on a rename.
 */
export const resolveInstructorRedirect = cache(async (tenant: string, slug: string): Promise<string | null> => {
  if (!isInstructorSlug(slug)) return null;
  const path = `/instructors/${slug}`;
  const target = await apiGetOrNull<RedirectTarget>(tenant, `/redirects/resolve?path=${encodeURIComponent(path)}`, {
    tags: [cacheTags.instructors(tenant), cacheTags.instructor(tenant, slug)],
  });
  const to = target?.to ?? '';
  return to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/\\') && to !== path ? to : null;
});
