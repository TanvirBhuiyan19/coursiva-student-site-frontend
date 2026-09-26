'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { ForgotPasswordInput, LoginInput, RegisterInput, User } from './types';

export const authKeys = { me: ['me'] as const };

/**
 * The signed-in learner, or `null` for guests. Public pages render for everyone on the server, then personalise from
 * this in the browser (enrolled badges, cart count, avatar) — so they stay cacheable.
 */
export function useSession() {
  const q = useQuery({
    queryKey: authKeys.me,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api.get<User>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.isUnauthenticated) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
  return { user: q.data ?? null, isLoading: q.isPending, isSignedIn: !!q.data };
}

/** After sign-in/out every learner-specific query is stale. */
function resetLearnerData(qc: QueryClient, user: User | null) {
  qc.setQueryData(authKeys.me, user);
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<User>('/auth/login', input),
    onSuccess: (user) => resetLearnerData(qc, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<User>('/auth/register', input),
    onSuccess: (user) => resetLearnerData(qc, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<undefined>('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(authKeys.me, null);
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (input: ForgotPasswordInput) => api.post<{ sent: boolean }>('/auth/forgot-password', input) });
}

/** Refresh header counters (cart, wishlist, notifications) after a mutation that changes them. */
export const refreshMe = (qc: QueryClient) => qc.invalidateQueries({ queryKey: authKeys.me });
