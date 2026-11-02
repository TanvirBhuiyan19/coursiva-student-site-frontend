'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import type { InstructorSummary } from './types';

export const instructorKeys = {
  list: (perPage: number) => ['instructors', 'list', perPage] as const,
};

/**
 * The instructor index beyond its first page. The server renders page 1 (crawlable, cached by the `instructors` tag)
 * and hands it over as the first page; "Show more" loads the next ones in the browser through the `/api/v1` proxy.
 */
export function useInstructorPages(first: Paginated<InstructorSummary>) {
  const perPage = first.meta.perPage;
  return useInfiniteQuery({
    queryKey: instructorKeys.list(perPage),
    queryFn: ({ pageParam }) => api.page<InstructorSummary>(`/instructors?page=${pageParam}&per_page=${perPage}`),
    initialPageParam: 1,
    initialData: { pages: [first], pageParams: [1] },
    // The first page came with the HTML: never refetch it behind the visitor's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    getNextPageParam: (last) => (last.meta.currentPage < last.meta.lastPage ? last.meta.currentPage + 1 : undefined),
  });
}
