'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { learningKeys } from '@/features/learning/api';
import type { Dashboard, LiveEvent } from '@/features/learning/types';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import type { CommunityOverview, NewPostInput, Post } from './types';

export const communityKeys = {
  overview: ['community', 'overview'] as const,
  posts: (space: string, sort: 'new' | 'top') => ['community', 'posts', space, sort] as const,
};

export function useCommunity() {
  return useQuery({ queryKey: communityKeys.overview, queryFn: () => api.get<CommunityOverview>('/community') });
}

export function usePosts(space: string, sort: 'new' | 'top', enabled = true) {
  return useInfiniteQuery({
    queryKey: communityKeys.posts(space, sort),
    queryFn: ({ pageParam }) => api.page<Post>(`/community/posts?space=${encodeURIComponent(space)}&sort=${sort}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.currentPage < last.meta.lastPage ? last.meta.currentPage + 1 : undefined),
    enabled,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPostInput) => api.post<Post>('/community/posts', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['community'] });
    },
  });
}

type PostPages = InfiniteData<Paginated<Post>>;

/** Like/unlike — optimistic across every cached feed containing the post. */
export function useToggleLike() {
  const qc = useQueryClient();
  const patch = (postId: string, liked: boolean) =>
    qc.setQueriesData<PostPages>({ queryKey: ['community', 'posts'] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              data: p.data.map((x) => (x.id === postId && x.liked !== liked ? { ...x, liked, likes: x.likes + (liked ? 1 : -1) } : x)),
            })),
          }
        : data,
    );
  return useMutation({
    mutationFn: ({ postId, liked }: { postId: string; liked: boolean }) =>
      liked ? api.put<Post>(`/community/posts/${postId}/like`) : api.delete<Post>(`/community/posts/${postId}/like`),
    onMutate: ({ postId, liked }) => patch(postId, liked),
    onError: (_e, { postId, liked }) => patch(postId, !liked),
  });
}

export function useRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, going }: { eventId: string; going: boolean }) =>
      going ? api.put<LiveEvent>(`/community/events/${eventId}/rsvp`) : api.delete<LiveEvent>(`/community/events/${eventId}/rsvp`),
    onSuccess: (event) => {
      qc.setQueryData<Dashboard>(learningKeys.dashboard, (d) => (d?.nextEvent?.id === event.id ? { ...d, nextEvent: event } : d));
      qc.setQueryData<CommunityOverview>(communityKeys.overview, (o) =>
        o ? { ...o, events: o.events.map((e) => (e.id === event.id ? event : e)) } : o,
      );
    },
  });
}
