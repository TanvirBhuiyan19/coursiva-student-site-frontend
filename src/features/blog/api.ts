'use client';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { BlogCommentInput } from './types';

/** Counts a read (`source` = where the reader came from; `readSeconds` when they leave). Best effort. */
export function reportBlogView(slug: string, body: { source?: string; readSeconds?: number }, keepalive = false) {
  void api.post<undefined>(`/blog/posts/${slug}/views`, body, { keepalive }).catch(() => undefined);
}

/** A comment waits for the school's moderation (`202`). */
export function useBlogComment(slug: string) {
  return useMutation({
    mutationFn: (input: BlogCommentInput) => api.post<{ received: boolean }>(`/blog/posts/${slug}/comments`, input),
    meta: { errorToast: false },
  });
}
