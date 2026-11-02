'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { normalizePage } from './normalize';
import type { FormSubmission, Page } from './types';

/**
 * Builder pages that depend on the visitor (password and members-only pages) are fetched here, in the browser, with
 * the visitor's own cookies — the shared server render only shows their gate. Also the visitor's page actions:
 * unlocking a password page or the whole site, and submitting a builder form.
 */
export const pageKeys = {
  page: (slug: string) => ['pages', slug] as const,
};

const pagePath = (slug: string) => `/pages/${slug.split('/').map(encodeURIComponent).join('/')}`;

export function useVisitorPage(slug: string) {
  return useQuery({
    queryKey: pageKeys.page(slug),
    queryFn: () => api.get<Page>(pagePath(slug)).then(normalizePage),
    retry: false,
  });
}

export function useUnlockPage(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<{ unlocked: boolean }>(`${pagePath(slug)}/unlock`, { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pageKeys.page(slug) }),
  });
}

/** Builder form. `action` is the API's `/api/v1/pages/{slug}/forms/{sectionId}`. Field ids are data: sent as-is. */
export function useSubmitForm(action: string) {
  return useMutation({
    mutationFn: (body: FormSubmission) => api.raw<{ received: boolean }>('POST', action.replace(/^\/api\/v1(?=\/)/, ''), body),
  });
}

/** Unlock a password-locked site, then switch this browser to personal rendering (see lib/api/personal.ts). */
export function useUnlockSite() {
  return useMutation({
    mutationFn: async (password: string) => {
      await api.post<{ unlocked: boolean }>('/site/unlock', { password });
      await enablePersonal();
    },
  });
}

/** Turns on personal rendering for this browser (`POST /__site`). Pages must then be reloaded. */
export async function enablePersonal() {
  const res = await fetch('/__site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=personal',
    credentials: 'same-origin',
    redirect: 'manual',
  });
  if (!res.ok && res.type !== 'opaqueredirect') throw new Error(`Couldn’t open the site (${res.status}).`);
}

/** The site's lock state as this browser sees it (its unlock cookie). */
export async function siteUnlockedForVisitor(): Promise<boolean> {
  const site = await api.get<{ siteLock?: { unlocked?: boolean } }>('/site');
  return site.siteLock?.unlocked === true;
}
