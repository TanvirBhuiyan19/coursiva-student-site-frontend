'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { PublicWebinar, WebinarJoin, WebinarRegistration, WebinarRegistrationInput } from './types';

export const webinarKeys = {
  page: (slug: string) => ['webinars', slug] as const,
};

/**
 * The webinar re-read in the browser: a fresh form token (the server-rendered page may be a minute old) and live seats.
 * `initial` is the server-rendered copy, shown until it arrives.
 */
export function useWebinar(slug: string, initial: PublicWebinar) {
  return useQuery({
    queryKey: webinarKeys.page(slug),
    queryFn: () => api.get<PublicWebinar>(`/webinars/${encodeURIComponent(slug)}`),
    placeholderData: initial,
    staleTime: 30_000,
  });
}

/** Registration with name and email (bot protection as the school's forms: token, honeypot, Turnstile). */
export function useRegisterWebinar(slug: string) {
  return useMutation({
    mutationFn: (input: WebinarRegistrationInput) =>
      api.post<WebinarRegistration>(`/webinars/${encodeURIComponent(slug)}/registrations`, input),
    meta: { errorToast: false },
  });
}

/** The personal join link: signs a guest account in, or confirms the signed-in owner. */
export const joinWebinar = (token: string) => api.post<WebinarJoin>('/webinars/join', { t: token });
