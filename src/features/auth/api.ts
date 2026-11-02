'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { conversionSignal } from '@/features/consent/tracking';
import { trackEvent } from '@/features/tracking/events';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput, User } from './types';

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
    // `tracking`: what the API may use for a server-side sign-up conversion (docs/api/auth.md).
    mutationFn: (input: RegisterInput) => {
      const tracking = conversionSignal();
      return api.post<User>('/auth/register', { ...input, ...(tracking ? { tracking } : {}) });
    },
    onSuccess: (user) => {
      resetLearnerData(qc, user);
      trackEvent({ name: 'sign_up', userId: user.id, method: 'email' });
    },
  });
}

/**
 * `POST /auth/logout` answers `204`, or `200 { redirectUrl }` when the session came from SAML single sign-on and the
 * school's identity provider signs out too (SAML single logout): the browser must then go to that IdP URL, which
 * comes back to the site's sign-in page.
 */
export interface LogoutResult {
  redirectUrl: string;
}

/** The IdP single-logout URL to follow after sign-out (absolute http(s) only), or null for the sign-in page. */
export function signOutRedirect(result: LogoutResult | undefined | null): string | null {
  const url = result?.redirectUrl;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LogoutResult | undefined>('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(authKeys.me, null);
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (input: ForgotPasswordInput) => api.post<{ sent: boolean }>('/auth/forgot-password', input) });
}

/** The emailed reset link (and the invited learner's first password). The learner signs in afterwards. */
export function useResetPassword() {
  return useMutation({ mutationFn: (input: ResetPasswordInput) => api.post<{ reset: boolean }>('/auth/reset-password', input) });
}

/** The emailed confirmation link. */
export function useVerifyEmail() {
  return useMutation({ mutationFn: (token: string) => api.post<{ verified: boolean }>('/auth/email/verify', { token }) });
}

/** Sends the signed-in learner a fresh confirmation link (`sent: false` when already confirmed). */
export function useResendVerification() {
  return useMutation({ mutationFn: () => api.post<{ sent: boolean }>('/auth/email/verification-notification') });
}

/** Refresh header counters (cart, wishlist, notifications) after a mutation that changes them. */
export const refreshMe = (qc: QueryClient) => qc.invalidateQueries({ queryKey: authKeys.me });
