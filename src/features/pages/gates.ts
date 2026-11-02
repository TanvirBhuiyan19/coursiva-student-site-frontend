import { ApiError } from '@/lib/api/errors';
import type { PageGate } from './types';

/** `GET /pages/{slug}` 401/403 answers → why the page can't be shown to this visitor (null = not a gate). */
export function pageGateOf(e: unknown): PageGate | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'page_password_required') return 'page_password_required';
  if (e.code === 'members_only') return e.status === 403 ? 'members_only_forbidden' : 'members_only';
  return null;
}
