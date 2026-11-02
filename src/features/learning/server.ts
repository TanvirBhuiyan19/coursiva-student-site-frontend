import 'server-only';
import { env } from '@/config/env';
import { camelize } from '@/lib/api/case';
import { ApiError } from '@/lib/api/errors';
import type { Resource } from '@/lib/api/types';
import type { PreviewLesson, PreviewSession } from './types';

/**
 * The staff preview's server reads (course builder O7, docs/api/learning.md → Staff preview). The token is the only
 * credential: no visitor cookies are forwarded and nothing is cached (each answer depends on the simulated now and the
 * token's expiry; the API sends `Cache-Control: no-store`).
 */

/** Real tokens are 32 random bytes in base64url (43 chars); anything else never reaches the API. */
export const isPreviewToken = (token: string) => /^[A-Za-z0-9_-]{16,128}$/.test(token);

/**
 * A failed read: `404` for an unknown, expired or revoked token (the site shows its own "expired" page with the
 * contract's sentence, whatever the body says — an API without previews answers 404 too).
 */
export type PreviewRead<T> = { ok: true; data: T } | { ok: false; status: number };

async function previewRead<T>(tenant: string, path: string, locale: string): Promise<PreviewRead<T>> {
  const res = await fetch(new URL(`${env.API_URL}/api/v1/preview${path}`), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.API_SERVICE_TOKEN}`,
      'X-Tenant': tenant,
      'Accept-Language': locale,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const error = await ApiError.from(res);
    // 4xx: the preview is gone (or this API doesn't serve previews) — the page says so. 5xx: a real error.
    if (error.status >= 500) throw error;
    return { ok: false, status: error.status };
  }
  return { ok: true, data: camelize<Resource<T>>(await res.json()).data };
}

export function getPreview(tenant: string, token: string, locale: string): Promise<PreviewRead<PreviewSession>> {
  return previewRead<PreviewSession>(tenant, `/${encodeURIComponent(token)}`, locale);
}

export function getPreviewLesson(tenant: string, token: string, lessonId: string, locale: string): Promise<PreviewRead<PreviewLesson>> {
  return previewRead<PreviewLesson>(tenant, `/${encodeURIComponent(token)}/lessons/${encodeURIComponent(lessonId)}`, locale);
}
