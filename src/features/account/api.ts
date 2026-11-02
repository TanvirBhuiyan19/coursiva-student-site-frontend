'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys, refreshMe } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import type {
  CancelFlow,
  CancelOffer,
  CancelSurvey,
  Certificate,
  LearnerSubscription,
  DiscordLink,
  Notification,
  PasswordInput,
  Preferences,
  Profile,
  ProfileInput,
  SupportTicketInput,
  NewsletterSignup,
  Download,
  HelpSearchResult,
  Survey,
  SurveyAnswer,
} from './types';

export const accountKeys = {
  profile: ['account', 'profile'] as const,
  notifications: ['account', 'notifications'] as const,
  certificates: ['account', 'certificates'] as const,
  discord: ['account', 'discord'] as const,
  survey: (id: string) => ['account', 'survey', id] as const,
  downloads: ['account', 'downloads'] as const,
  subscriptions: ['account', 'subscriptions'] as const,
  helpSearch: (q: string) => ['help', 'search', q] as const,
};

export function useDownloads() {
  return useQuery({ queryKey: accountKeys.downloads, queryFn: () => api.get<Download[]>('/me/downloads') });
}

/**
 * A 15-minute signed link for one purchased file (each link counts against the product's download limit). The list is
 * re-read so `downloads_left` stays right.
 */
export function useDownloadLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, productId }: { orderId: string; productId: string }) =>
      api.post<{ url: string; expiresAt: string }>(`/me/downloads/${encodeURIComponent(orderId)}/${encodeURIComponent(productId)}/link`),
    meta: { errorToast: false },
    onSettled: () => void qc.invalidateQueries({ queryKey: accountKeys.downloads }),
  });
}

export function useSurvey(id: string | null) {
  return useQuery({
    queryKey: accountKeys.survey(id ?? ''),
    queryFn: () => api.get<Survey>(`/me/surveys/${encodeURIComponent(id ?? '')}`),
    enabled: !!id,
    retry: false,
  });
}

export function useAnswerSurvey(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answer: SurveyAnswer) => api.post<{ received: boolean }>(`/me/surveys/${encodeURIComponent(id)}/answers`, answer),
    meta: { errorToast: false },
    onSuccess: () => qc.setQueryData<Survey>(accountKeys.survey(id), (s) => (s ? { ...s, answered: true } : s)),
  });
}

/**
 * Opens the payment provider's billing portal (`GET /me/billing-portal?return=`). Laravel answers a `302` to the portal
 * (or `{ url }`), or a JSON error (`409` "no payment details on file") that the page shows instead of raw JSON.
 */
export async function openBillingPortal(returnPath: string): Promise<{ error: string } | null> {
  const href = `/api/v1/me/billing-portal?return=${encodeURIComponent(returnPath)}`;
  try {
    const res = await fetch(href, { redirect: 'manual', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (res.type === 'opaqueredirect') {
      // A full navigation: the API redirects to the provider's portal (another origin).
      window.location.assign(new URL(href, window.location.origin).href);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { data?: { url?: unknown }; message?: unknown } | null;
    if (res.ok && typeof body?.data?.url === 'string' && /^https:\/\//.test(body.data.url)) {
      window.location.assign(body.data.url);
      return null;
    }
    return { error: typeof body?.message === 'string' ? body.message : '' };
  } catch {
    return { error: '' };
  }
}

/** The learner's memberships and course subscriptions (`GET /me/subscriptions`). */
export function useSubscriptions() {
  return useQuery({ queryKey: accountKeys.subscriptions, queryFn: () => api.get<LearnerSubscription[]>('/me/subscriptions') });
}

/** A changed subscription replaces its row; the profile (its membership line) is read again. */
function useSubscriptionWrite<V>(fn: (v: V) => Promise<LearnerSubscription>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: { errorToast: false },
    onSuccess: (row) => {
      qc.setQueryData<LearnerSubscription[]>(accountKeys.subscriptions, (rows) => rows?.map((r) => (r.id === row.id ? row : r)));
      void qc.invalidateQueries({ queryKey: accountKeys.profile });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: accountKeys.subscriptions }),
  });
}

/** Starts the cancel flow: the server records it and answers the save offers it may show. */
export function useStartCancelFlow() {
  return useMutation({
    mutationFn: (id: string) => api.post<CancelFlow>(`/me/subscriptions/${encodeURIComponent(id)}/cancel-flow`),
    meta: { errorToast: false },
  });
}

export function useSaveSubscription() {
  return useSubscriptionWrite(
    ({ id, flowId, offer, ...survey }: { id: string; flowId: string; offer: CancelOffer['key'] } & CancelSurvey) =>
      api.post<LearnerSubscription>(`/me/subscriptions/${encodeURIComponent(id)}/save`, { flowId, offer, ...survey }),
  );
}

/** Cancels at the end of the paid period; the flow and the survey are optional. */
export function useCancelSubscription() {
  return useSubscriptionWrite(({ id, flowId, ...survey }: { id: string; flowId?: string | null } & CancelSurvey) =>
    api.post<LearnerSubscription>(`/me/subscriptions/${encodeURIComponent(id)}/cancel`, { flowId: flowId ?? null, ...survey }),
  );
}

/** Resumes a paused subscription, or undoes a cancellation before access ends. */
export function useResumeSubscription() {
  return useSubscriptionWrite((id: string) => api.post<LearnerSubscription>(`/me/subscriptions/${encodeURIComponent(id)}/resume`));
}

export function useNotifications(enabled: boolean) {
  return useQuery({ queryKey: accountKeys.notifications, queryFn: () => api.get<Notification[]>('/me/notifications'), enabled });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ read: boolean }>('/me/notifications/read-all'),
    onSuccess: () => {
      qc.setQueryData<Notification[]>(accountKeys.notifications, (rows) => rows?.map((n) => ({ ...n, read: true })));
      void refreshMe(qc);
    },
  });
}

export function useProfile() {
  return useQuery({ queryKey: accountKeys.profile, queryFn: () => api.get<Profile>('/me/profile') });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => api.patch<Profile>('/me/profile', input),
    onSuccess: (profile) => {
      qc.setQueryData(accountKeys.profile, profile);
      void qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useUpdatePassword() {
  return useMutation({ mutationFn: (input: PasswordInput) => api.put<{ updated: boolean }>('/me/password', input) });
}

/** Toggles save immediately, optimistically, and roll back if the API refuses. */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Preferences) => api.put<Preferences>('/me/preferences', prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: accountKeys.profile });
      const prev = qc.getQueryData<Profile>(accountKeys.profile);
      if (prev) qc.setQueryData<Profile>(accountKeys.profile, { ...prev, preferences: prefs });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(accountKeys.profile, ctx.prev);
    },
  });
}

export function useCertificates() {
  return useQuery({ queryKey: accountKeys.certificates, queryFn: () => api.get<Certificate[]>('/me/certificates') });
}

export function useDiscordLink() {
  return useQuery({ queryKey: accountKeys.discord, queryFn: () => api.get<DiscordLink>('/me/discord') });
}

/** 204; the API removes the roles Coursiva gave and revokes the grant at Discord (queued). */
export function useUnlinkDiscord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<undefined>('/me/discord'),
    onSettled: () => qc.invalidateQueries({ queryKey: accountKeys.discord }),
  });
}

/**
 * Help-centre search (`GET /help/search?q=`). Runs once the query has a word of 2+ characters; the previous results
 * stay on screen while the next ones load. A failure (e.g. an API without search yet) surfaces as `isError`.
 */
export function useHelpSearch(q: string) {
  const query = q.trim();
  return useQuery<HelpSearchResult[]>({
    queryKey: accountKeys.helpSearch(query),
    queryFn: () => api.get<HelpSearchResult[]>(`/help/search?q=${encodeURIComponent(query)}`),
    enabled: query.split(/\s+/).some((w) => w.length >= 2),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSupportTicket() {
  return useMutation({ mutationFn: (input: SupportTicketInput) => api.post<{ id: string }>('/support/tickets', input) });
}

export function useNewsletterSignup() {
  return useMutation({
    mutationFn: (email: string) => api.post<NewsletterSignup>('/newsletter', { email }),
  });
}

/** Confirms a double opt-in subscription from the emailed link (`/subscribe/confirm?token=`). */
export function useConfirmSubscription() {
  return useMutation({ mutationFn: (token: string) => api.post<{ confirmed: boolean }>('/forms/confirm', { token }) });
}
