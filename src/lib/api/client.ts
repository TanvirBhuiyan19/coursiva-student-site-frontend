'use client';
import { camelize, snakeize } from './case';
import { ApiError } from './errors';
import type { Paginated, Resource } from './types';

/**
 * Browser → same-origin `/api/v1/*` (the proxy forwards to Laravel). Sanctum SPA auth: the session lives in an httpOnly
 * cookie on the tenant's host; mutations echo the XSRF-TOKEN cookie as X-XSRF-TOKEN. Only feature `api.ts` files call this.
 */

const BASE = '/api/v1';

function xsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

let csrfPromise: Promise<void> | null = null;
async function ensureCsrf() {
  if (xsrfToken()) return;
  csrfPromise ??= fetch('/sanctum/csrf-cookie', { credentials: 'same-origin' }).then(() => {
    csrfPromise = null;
  });
  await csrfPromise;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const mutating = method !== 'GET';
  if (mutating) await ensureCsrf();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    // The page language (<html lang>, set from the URL): learner data such as notifications comes back translated.
    'Accept-Language': document.documentElement.lang || 'en',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = xsrfToken();
  if (mutating && token) headers['X-XSRF-TOKEN'] = token;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(snakeize(body)),
  });
  // 419 = CSRF token expired: refresh it once and retry.
  if (res.status === 419 && !retried) {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
    return request<T>(method, path, body, true);
  }
  if (!res.ok) throw await ApiError.from(res);
  if (res.status === 204) return undefined as T;
  return camelize<T>(await res.json());
}

export const api = {
  get: async <T>(path: string) => (await request<Resource<T>>('GET', path)).data,
  page: <T>(path: string) => request<Paginated<T>>('GET', path),
  post: async <T>(path: string, body?: unknown) => (await request<Resource<T> | undefined>('POST', path, body ?? {}))?.data as T,
  put: async <T>(path: string, body?: unknown) => (await request<Resource<T> | undefined>('PUT', path, body ?? {}))?.data as T,
  patch: async <T>(path: string, body?: unknown) => (await request<Resource<T> | undefined>('PATCH', path, body ?? {}))?.data as T,
  delete: async <T>(path: string) => (await request<Resource<T> | undefined>('DELETE', path))?.data as T,
};
