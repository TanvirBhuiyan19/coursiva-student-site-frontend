'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CoursePreview } from './types';

export const catalogKeys = {
  preview: (slug: string, lessonId: string | null) => ['catalog', 'preview', slug, lessonId ?? ''] as const,
};

/** `/courses/{slug}/preview`, with `?lesson=` for a chosen free preview (none: the first). */
export const coursePreviewPath = (slug: string, lessonId: string | null) =>
  `/courses/${encodeURIComponent(slug)}/preview${lessonId ? `?lesson=${encodeURIComponent(lessonId)}` : ''}`;

/**
 * A free-preview lesson (`GET /courses/{slug}/preview?lesson=`), fetched in the browser only while the preview is
 * open. Its URLs are signed and short-lived (`Cache-Control: private, no-store`), so nothing keeps them: no stale
 * time, dropped from the cache as soon as the preview closes or switches lesson (`gcTime: 0`, the observer unmounts),
 * and no background refetch that would swap the source mid-playback.
 */
export function useCoursePreview(slug: string, lessonId: string | null = null) {
  return useQuery({
    queryKey: catalogKeys.preview(slug, lessonId),
    queryFn: () => api.get<CoursePreview>(coursePreviewPath(slug, lessonId)),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
