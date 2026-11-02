'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRsvp } from '@/features/community/api';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type {
  CalendarFeedLink,
  CalendarFeedStatus,
  LiveSchedulePage,
  LiveScope,
  LiveSession,
  RoomChatPage,
  RoomFeed,
  RoomToken,
} from './types';

export const liveKeys = {
  all: ['live'] as const,
  session: (id: string) => ['live', 'session', id] as const,
  room: (id: string) => ['live', 'room', id] as const,
  schedule: (scope: LiveScope, limit: number) => ['live', 'schedule', scope, limit] as const,
  calendar: ['live', 'calendar'] as const,
};

/** The learner's schedule, a page of `limit` at a time ("Show more" follows `next_cursor`). Re-read every minute. */
export function useLiveSchedule(scope: LiveScope, limit = 20, enabled = true) {
  return useInfiniteQuery({
    queryKey: liveKeys.schedule(scope, limit),
    queryFn: ({ pageParam }) =>
      api.get<LiveSchedulePage>(`/me/live?scope=${scope}&limit=${limit}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
    enabled,
  });
}

/** RSVP from a schedule row: the community hook, then the schedule and that session re-read. */
export function useScheduleRsvp() {
  const qc = useQueryClient();
  const rsvp = useRsvp();
  return {
    ...rsvp,
    mutate: (vars: { eventId: string; going: boolean }) =>
      rsvp.mutate(vars, { onSuccess: () => void qc.invalidateQueries({ queryKey: liveKeys.all }) }),
  };
}

/** The calendar feed: its status, making a new link (shown once) and turning it off. */
export function useCalendarFeed() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: liveKeys.calendar, queryFn: () => api.get<CalendarFeedStatus>('/me/live/calendar') });
  const subscribe = useMutation({
    mutationFn: () => api.post<CalendarFeedLink>('/me/live/calendar'),
    onSuccess: (link) => qc.setQueryData(liveKeys.calendar, { active: true, createdAt: link.createdAt, lastUsedAt: null }),
  });
  const revoke = useMutation({
    mutationFn: () => api.delete<undefined>('/me/live/calendar'),
    onSuccess: () => qc.setQueryData(liveKeys.calendar, { active: false, createdAt: null, lastUsedAt: null }),
  });
  return { status, subscribe, revoke };
}

/** One session; re-read every 20 s while the room is open (it goes live, polls open and close). */
export function useLiveSession(id: string, poll = false) {
  return useQuery({
    queryKey: liveKeys.session(id),
    queryFn: () => api.get<LiveSession>(`/me/live/${encodeURIComponent(id)}`),
    refetchInterval: poll ? 20_000 : false,
  });
}

/** RSVP from the session page (the community hook, then this session re-read for its join link). */
export function useSessionRsvp(id: string) {
  const qc = useQueryClient();
  const rsvp = useRsvp();
  return {
    ...rsvp,
    mutate: (going: boolean) =>
      rsvp.mutate({ eventId: id, going }, { onSuccess: () => void qc.invalidateQueries({ queryKey: liveKeys.all }) }),
  };
}

const room = (id: string) => `/me/live/${encodeURIComponent(id)}`;

/** The learner was removed from the session by the host (every room call answers 403 `reason: removed`). */
export const isRemoved = (err: unknown) => err instanceof ApiError && err.status === 403 && err.reason === 'removed';

/**
 * The room's state for this learner — chat (hidden messages never come back), the pinned message, polls with live
 * results, their hand, stage invite, mute and breakout room — re-read every 4 s while the room is live. Moderation by
 * the host reaches the learner through here. Stops polling once the learner is removed.
 */
export function useRoomFeed(id: string, enabled: boolean) {
  return useQuery({
    queryKey: liveKeys.room(id),
    queryFn: () => api.get<RoomFeed>(`${room(id)}/room`),
    enabled,
    refetchInterval: (q) => (isRemoved(q.state.error) ? false : 4_000),
    retry: (count, err) => !isRemoved(err) && count < 2,
  });
}

/** Older chat messages, oldest first. */
export const fetchRoomChat = (id: string, before: string) => api.get<RoomChatPage>(`${room(id)}/chat?before=${encodeURIComponent(before)}`);

/**
 * A fresh meeting token for the room's video (asked for on every join and rejoin: tokens are short-lived). `t` is the
 * unique join link's token from the room URL: the server only opens it for the learner it was sent to.
 */
export const fetchRoomToken = (id: string, t?: string | null) => api.post<RoomToken>(`${room(id)}/token`, t ? { t } : undefined);

/** A meeting token for the learner's breakout room (while breakout rooms are open). */
export const fetchBreakoutToken = (id: string) => api.post<RoomToken>(`${room(id)}/breakout/token`);

/** Attendance: about once a minute while the learner has the room open. */
export const sendPresence = (id: string) => api.post<undefined>(`${room(id)}/presence`).catch(() => undefined);

export function useRoomActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: liveKeys.room(id) });
  return {
    question: useMutation({
      mutationFn: (text: string) => api.post<undefined>(`${room(id)}/questions`, { text }),
      meta: { errorToast: false },
    }),
    chat: useMutation({
      mutationFn: (message: string) => api.post<undefined>(`${room(id)}/chat`, { message }),
      onSuccess: refresh,
      meta: { errorToast: false },
    }),
    hand: useMutation({
      mutationFn: (raised: boolean) => (raised ? api.post<undefined>(`${room(id)}/hands`) : api.delete<undefined>(`${room(id)}/hands`)),
      onSettled: refresh,
    }),
    vote: useMutation({
      mutationFn: ({ poll, option }: { poll: string; option: number }) =>
        api.post<undefined>(`${room(id)}/polls/${encodeURIComponent(poll)}/votes`, { option }),
      onSettled: refresh,
      meta: { errorToast: false },
    }),
    stage: useMutation({
      mutationFn: (accept: boolean) => api.post<undefined>(`${room(id)}/stage/${accept ? 'accept' : 'leave'}`),
      onSettled: refresh,
    }),
  };
}
