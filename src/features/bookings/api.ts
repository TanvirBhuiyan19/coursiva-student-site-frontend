'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/features/auth/api';
import type { ProductPage } from '@/features/commerce/types';
import { api } from '@/lib/api/client';
import type { Availability, BookInput, BookResult, JoinInfo, LearnerBooking, MyBookings } from './types';

export const AVAILABILITY_DAYS = 14;

export const bookingKeys = {
  all: ['bookings'] as const,
  mine: ['bookings', 'mine'] as const,
  one: (id: string) => ['bookings', 'one', id] as const,
  product: (slug: string) => ['bookings', 'product', slug] as const,
  availability: (slug: string, from: string, timezone: string) => ['bookings', 'availability', slug, from, timezone] as const,
};

const enc = encodeURIComponent;

/**
 * Bookable times of a service for `AVAILABILITY_DAYS` days from `from` (the learner's local date), grouped in
 * `timezone`. Always read fresh (the API answers `no-store`): a slot someone just took must not linger.
 */
export function useAvailability(slug: string, from: string | null, timezone: string | null) {
  return useQuery({
    queryKey: bookingKeys.availability(slug, from ?? '', timezone ?? ''),
    queryFn: () =>
      api.get<Availability>(
        `/products/${enc(slug)}/availability?from=${enc(from ?? '')}&days=${AVAILABILITY_DAYS}&timezone=${enc(timezone ?? '')}`,
      ),
    enabled: !!from && !!timezone,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * The learner's sessions and credits (`enabled` = signed in). Re-read on every mount: holds lapse and checkout or the
 * school change them server-side.
 */
export function useMyBookings(enabled = true) {
  return useQuery({ queryKey: bookingKeys.mine, queryFn: () => api.get<MyBookings>('/me/bookings'), enabled, staleTime: 0 });
}

export function useBooking(id: string) {
  return useQuery({ queryKey: bookingKeys.one(id), queryFn: () => api.get<LearnerBooking>(`/me/bookings/${enc(id)}`), staleTime: 0 });
}

/** Every booking read (list, detail, availability) is stale after a change. */
function useRefreshBookings() {
  const qc = useQueryClient();
  return (b?: LearnerBooking) => {
    if (b) qc.setQueryData(bookingKeys.one(b.id), b);
    void qc.invalidateQueries({ queryKey: bookingKeys.all });
  };
}

export function useBook(slug: string) {
  const refresh = useRefreshBookings();
  return useMutation({
    mutationFn: (input: BookInput) => api.post<BookResult>(`/products/${enc(slug)}/bookings`, input),
    meta: { errorToast: false },
    onSuccess: (r) => refresh(r.booking),
  });
}

export function useReschedule(id: string) {
  const refresh = useRefreshBookings();
  return useMutation({
    mutationFn: (input: { startsAt: string; timezone: string }) => api.post<LearnerBooking>(`/me/bookings/${enc(id)}/reschedule`, input),
    meta: { errorToast: false },
    onSuccess: refresh,
  });
}

export function useCancelBooking(id: string) {
  const refresh = useRefreshBookings();
  return useMutation({
    mutationFn: (reason: string) => api.post<LearnerBooking>(`/me/bookings/${enc(id)}/cancel`, reason ? { reason } : {}),
    meta: { errorToast: false },
    onSuccess: refresh,
  });
}

/** Asked on every join (the room token is short-lived). */
export const joinBooking = (id: string) => api.post<JoinInfo>(`/me/bookings/${enc(id)}/join`);

/** Same-origin download of the session's calendar file (`text/calendar`). */
export const bookingCalendarUrl = (id: string) => `/api/v1/me/bookings/${enc(id)}/calendar.ics`;

/**
 * Checkout of a `?product=` target: whether it is a service (its public sales page says so) and the learner's live hold
 * on one of its times, if any (shown with a countdown; paying confirms it).
 */
export function useServiceCheckout(slug: string | null) {
  const { isSignedIn } = useSession();
  const product = useQuery({
    queryKey: bookingKeys.product(slug ?? ''),
    queryFn: () => api.get<ProductPage>(`/products/${enc(slug ?? '')}`),
    enabled: !!slug,
    staleTime: 60_000,
  });
  const isService = product.data?.kind === 'service';
  const mine = useMyBookings(isService && isSignedIn);
  const hold = mine.data?.upcoming.find((b) => b.status === 'held' && b.product.slug === slug) ?? null;
  return { isService, hold };
}
