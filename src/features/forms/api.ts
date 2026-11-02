'use client';
import { useQuery } from '@tanstack/react-query';
import { camelize } from '@/lib/api/case';
import { ApiError } from '@/lib/api/errors';
import { normalizeForm } from './logic';
import type { FormUpload, SubmissionResult } from './types';

/**
 * The public lead-form API (docs/api/forms.md), same-origin through the proxy like every browser call. These calls are
 * anonymous on purpose: no cookies (`credentials: 'omit'`) and no CSRF handshake — the API exempts them and the signed
 * form token is the proof. That also keeps them working inside the embed frame on other websites, where the school's
 * cookies are third-party and usually blocked.
 *
 * Bodies and error keys are handled raw (no snake/camel conversion): `values` and `values.{key}` carry field keys,
 * which are data.
 */

const BASE = '/api/v1/forms';
const formPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

const headers = (json: boolean): Record<string, string> => ({
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept-Language': document.documentElement.lang || 'en',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

/** A non-2xx answer as an ApiError whose `fieldErrors` keep the API's keys verbatim (`values.first_name`, `token`). */
export function errorFrom(status: number, statusText: string, body: unknown): ApiError {
  const b = body && typeof body === 'object' ? (body as { message?: unknown; errors?: unknown; code?: unknown }) : {};
  const errors: Record<string, string> = {};
  if (b.errors && typeof b.errors === 'object')
    for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) {
      const first: unknown = Array.isArray(v) ? v[0] : v;
      if (typeof first === 'string') errors[k] = first;
    }
  const message = typeof b.message === 'string' ? b.message : statusText || `Request failed (${status})`;
  return new ApiError(status, message, errors, typeof b.code === 'string' ? b.code : null);
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: headers(body !== undefined),
    credentials: 'omit',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw errorFrom(res.status, res.statusText, json);
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export const formKeys = { form: (id: string) => ['lead-form', id] as const };

/**
 * The form with a fresh token, fetched once per mount (never refetched behind the visitor's back: a new token would
 * restart the anti-spam clock and drop uploads made with the old one).
 */
export function usePublicForm(id: string) {
  return useQuery({
    queryKey: formKeys.form(id),
    queryFn: async () => normalizeForm(camelize(await call<unknown>('GET', formPath(id)))),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Counts a view (deduplicated per visitor and day by the API). Failures don't matter to the visitor. */
export function recordView(id: string, token: string): Promise<void> {
  return call<undefined>('POST', `${formPath(id)}/views`, { token }).then(
    () => undefined,
    () => undefined,
  );
}

export async function submitForm(id: string, body: Record<string, unknown>): Promise<SubmissionResult> {
  const r = camelize<Partial<SubmissionResult>>(await call<unknown>('POST', `${formPath(id)}/submissions`, body));
  return {
    received: r.received === true,
    confirmationRequired: r.confirmationRequired === true,
    submissionId: typeof r.submissionId === 'string' ? r.submissionId : null,
    successMessage: typeof r.successMessage === 'string' ? r.successMessage : '',
    redirectUrl: typeof r.redirectUrl === 'string' && r.redirectUrl !== '' ? r.redirectUrl : null,
  };
}

/** An upload in flight: its promise and a way to cancel it. */
export interface UploadTask {
  done: Promise<FormUpload>;
  abort: () => void;
}

/**
 * `POST /forms/{id}/uploads` (multipart `token`, `field`, `file`) with progress. XHR rather than fetch: fetch can't
 * report upload progress.
 */
export function uploadFile(
  id: string,
  input: { token: string; field: string; file: File },
  onProgress: (fraction: number) => void,
): UploadTask {
  const xhr = new XMLHttpRequest();
  const done = new Promise<FormUpload>((resolve, reject) => {
    xhr.open('POST', `${formPath(id)}/uploads`);
    xhr.withCredentials = false;
    for (const [k, v] of Object.entries(headers(false))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        json = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(errorFrom(xhr.status, xhr.statusText, json));
        return;
      }
      const data = camelize<Partial<FormUpload>>(json && typeof json === 'object' && 'data' in json ? json.data : json);
      if (typeof data.id !== 'string') {
        reject(new ApiError(500, 'Upload failed.'));
        return;
      }
      resolve({
        id: data.id,
        name: typeof data.name === 'string' ? data.name : input.file.name,
        sizeBytes: data.sizeBytes ?? input.file.size,
      });
    };
    xhr.onerror = () => {
      reject(new ApiError(0, 'Network error.'));
    };
    xhr.onabort = () => {
      reject(new ApiError(0, 'aborted', {}, 'aborted'));
    };
    const fd = new FormData();
    fd.append('token', input.token);
    fd.append('field', input.field);
    fd.append('file', input.file);
    xhr.send(fd);
  });
  return { done, abort: () => xhr.abort() };
}
