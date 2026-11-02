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

interface RequestOptions {
  /** Let the request outlive the page (`fetch` keepalive) — for reports sent on `pagehide`/`visibilitychange`. */
  keepalive?: boolean;
  /**
   * Send and return JSON exactly as on the wire, without snake/camel conversion. Only for payloads whose keys are data
   * (the SCORM data model: `{"cmi.core.lesson_status": "passed"}`) — see `features/learning/scorm`.
   */
  raw?: boolean;
}

/**
 * The staff preview (`/preview/{token}`, course builder O7) has no learner session: the token in the path is the only
 * credential. On a preview page every request goes to `/api/v1/preview/…` without cookies (`credentials: 'omit'`, so
 * nothing is sent and no cookie is ever set) and without the CSRF handshake; anything else — a learner `/me/…`
 * report, a session read — is refused here, before it leaves the browser.
 */
const onPreviewPage = () => typeof window !== 'undefined' && /^\/preview(?:\/|$)/.test(window.location.pathname);
const isPreviewApi = (path: string) => path.startsWith('/preview/');

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}, retried = false): Promise<T> {
  const mutating = method !== 'GET';
  const stateless = isPreviewApi(path);
  if (!stateless && onPreviewPage()) throw new ApiError(403, 'Not available in preview.', {}, 'preview');
  if (mutating && !stateless) await ensureCsrf();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    // The page language (<html lang>, set from the URL): learner data such as notifications comes back translated.
    'Accept-Language': document.documentElement.lang || 'en',
  };
  // FormData (multipart uploads) sets its own Content-Type with the boundary.
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  const token = stateless ? null : xsrfToken();
  if (mutating && token) headers['X-XSRF-TOKEN'] = token;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: stateless ? 'omit' : 'same-origin',
    keepalive: opts.keepalive === true,
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(opts.raw ? body : snakeize(body)),
  });
  // 419 = CSRF token expired: refresh it once and retry.
  if (res.status === 419 && !retried && !stateless) {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
    return request<T>(method, path, body, opts, true);
  }
  if (!res.ok) throw await ApiError.from(res);
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return opts.raw ? (json as T) : camelize<T>(json);
}

export const api = {
  get: async <T>(path: string) => (await request<Resource<T>>('GET', path)).data,
  page: <T>(path: string) => request<Paginated<T>>('GET', path),
  post: async <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    (await request<Resource<T> | undefined>('POST', path, body ?? {}, opts))?.data as T,
  put: async <T>(path: string, body?: unknown) => (await request<Resource<T> | undefined>('PUT', path, body ?? {}))?.data as T,
  patch: async <T>(path: string, body?: unknown) => (await request<Resource<T> | undefined>('PATCH', path, body ?? {}))?.data as T,
  delete: async <T>(path: string) => (await request<Resource<T> | undefined>('DELETE', path))?.data as T,
  /** Multipart POST (file uploads). Field names are sent as given — use the API's snake_case names (`files[]`). */
  form: async <T>(path: string, form: FormData) => (await request<Resource<T> | undefined>('POST', path, form))?.data as T,
  /** No case conversion either way (see `RequestOptions.raw`). Returns the `data` member as sent by the API. */
  raw: async <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, opts: Omit<RequestOptions, 'raw'> = {}) =>
    (await request<Resource<T> | undefined>(method, path, method === 'GET' ? undefined : (body ?? {}), { ...opts, raw: true }))?.data as T,
};
