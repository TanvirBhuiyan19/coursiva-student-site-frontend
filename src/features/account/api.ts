'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys, refreshMe } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import type { Certificate, Notification, PasswordInput, Preferences, Profile, ProfileInput, SupportTicketInput } from './types';

export const accountKeys = {
  profile: ['account', 'profile'] as const,
  notifications: ['account', 'notifications'] as const,
  certificates: ['account', 'certificates'] as const,
};

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

export function useSupportTicket() {
  return useMutation({ mutationFn: (input: SupportTicketInput) => api.post<{ id: string }>('/support/tickets', input) });
}

export function useNewsletterSignup() {
  return useMutation({ mutationFn: (email: string) => api.post<{ subscribed: boolean }>('/newsletter', { email }) });
}
