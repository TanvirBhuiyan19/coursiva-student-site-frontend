'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocalePrefix } from '@/i18n/navigation';
import { authKeys } from '../api';
import { sessionExpiry } from '../sessionExpiry';

/**
 * Watches every query and mutation for a `401`: on a private page (or when a signed-in learner acted) the session has
 * expired, so the cached learner data is dropped and the browser goes to sign-in with the page as `next` and the
 * "session expired" message. A read on a public page only refreshes the session (the page shows its guest state).
 */
export function SessionExpiryWatcher() {
  const qc = useQueryClient();
  const prefix = useLocalePrefix();

  useEffect(() => {
    let leaving = false;
    const handle = (error: unknown, mutation: boolean) => {
      if (leaving) return;
      const outcome = sessionExpiry(error, {
        pathname: window.location.pathname,
        search: window.location.search,
        prefix,
        signedIn: !!qc.getQueryData(authKeys.me),
        mutation,
      });
      if (!outcome) return;
      if ('refresh' in outcome) {
        void qc.invalidateQueries({ queryKey: authKeys.me });
        return;
      }
      leaving = true;
      // Nothing the expired session loaded may outlive it (the next sign-in may be someone else).
      qc.clear();
      window.location.assign(outcome.redirect);
    };
    const queries = qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') handle(e.action.error, false);
    });
    const mutations = qc.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') handle(e.action.error, true);
    });
    return () => {
      queries();
      mutations();
    };
  }, [qc, prefix]);

  return null;
}
