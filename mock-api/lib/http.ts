import type { Context } from 'hono';
import { camelize, snakeize } from '@/lib/api/case';

/** Response helpers that mimic Laravel: `{ data }` resources, `{ data, meta }` pages, 422/401/403/404 bodies. */

export const ok = (c: Context, data: unknown, status: 200 | 201 = 200): Response =>
  c.json(snakeize({ data }) as Record<string, unknown>, status);

export const noContent = (c: Context): Response => c.body(null, 204);

export function paginate<T>(c: Context, rows: T[], perPage = 20): Response {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const lastPage = Math.max(1, Math.ceil(rows.length / perPage));
  const data = rows.slice((page - 1) * perPage, page * perPage);
  return c.json(snakeize({ data, meta: { currentPage: page, lastPage, perPage, total: rows.length } }) as Record<string, unknown>);
}

export const invalid = (c: Context, errors: Record<string, string>): Response =>
  c.json(
    snakeize({
      message: Object.values(errors)[0] ?? 'The given data was invalid.',
      errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])),
    }) as Record<string, unknown>,
    422,
  );

export const unauthorized = (c: Context): Response => c.json({ message: 'Unauthenticated.' }, 401);
export const forbidden = (c: Context, message = 'This action is unauthorized.'): Response => c.json({ message }, 403);
export const notFound = (c: Context, what = 'Resource'): Response => c.json({ message: `${what} not found.` }, 404);

/** Parse a JSON body into camelCase. Returns {} for empty/invalid bodies — validation happens per route. */
export async function body<T extends object>(c: Context): Promise<Partial<T>> {
  try {
    return camelize<Partial<T>>(await c.req.json());
  } catch {
    return {};
  }
}

export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

let seq = 1000;
export const id = (prefix: string) => `${prefix}_${(seq++).toString(36)}`;

export const ago = ({ d = 0, h = 0, m = 0 }: { d?: number; h?: number; m?: number }) =>
  new Date(Date.now() - ((d * 24 + h) * 60 + m) * 60_000).toISOString();
