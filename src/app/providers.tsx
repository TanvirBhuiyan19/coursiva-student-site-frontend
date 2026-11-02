'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/toast/Toaster';
import { SessionExpiryWatcher } from '@/features/auth/components/SessionExpiryWatcher';
import { configureConsent } from '@/features/consent/tracking';
import { ApiError } from '@/lib/api/errors';
import { isPreviewPath } from '@/lib/securityHeaders';
import { SchoolTimeZone } from '@/lib/schoolTimeZone';

/**
 * Client-side state for learner data (TanStack Query). Public page content comes from the server, not from here.
 * Also starts cookie consent (docs/consent.md): `consentRequired` is the school's cookie banner setting (on = ask
 * first). Once the visitor allows it, the visit's first-touch acquisition hints and the partner link (`?ref=`,
 * 30 days) are kept for the checkout (`features/consent/tracking`).
 */
export function Providers({
  children,
  timeZone = null,
  consentRequired = true,
}: {
  children: ReactNode;
  timeZone?: string | null;
  consentRequired?: boolean;
}) {
  useEffect(() => {
    // The staff preview isn't a visit: no consent mode (nothing is granted), no acquisition hints, no partner click.
    if (isPreviewPath(window.location.pathname)) return;
    configureConsent({ required: consentRequired });
  }, [consentRequired]);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionExpiryWatcher />
      <SchoolTimeZone value={timeZone}>
        <ToastProvider>{children}</ToastProvider>
      </SchoolTimeZone>
    </QueryClientProvider>
  );
}
