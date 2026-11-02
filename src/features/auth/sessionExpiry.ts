/**
 * Expired learner sessions (session timeout, a password change elsewhere, the school's session-length policy): the
 * cookie is still there, so the proxy lets a private page render, but the API answers `401`. Instead of the generic
 * "Something went wrong", the learner goes to sign-in with the page as `next` and a friendly message
 * (`?reason=session_expired`). Pure — `components/SessionExpiryWatcher` applies it to the query client.
 */
import { stripPrefix, withPrefix } from '@/i18n/locales';
import { ApiError } from '@/lib/api/errors';
import { isPrivatePath, routes } from '@/lib/routes';
import { isPreviewPath } from '@/lib/securityHeaders';

export const SESSION_EXPIRED = 'session_expired';

export interface ExpiryContext {
  /** `window.location.pathname` / `.search` (with the locale prefix). */
  pathname: string;
  search: string;
  /** The current locale's URL prefix (`''` or `/es`). */
  prefix: string;
  /** The cached session said a learner was signed in. */
  signedIn: boolean;
  /** A mutation (the learner acted) rather than a background read. */
  mutation: boolean;
}

/**
 * What a failed request means for the session: `redirect` to sign-in (the URL to load), `refresh` the session (a read
 * on a public page: the page falls back to its guest state), or nothing.
 */
export function sessionExpiry(err: unknown, ctx: ExpiryContext): { redirect: string } | { refresh: true } | null {
  if (!(err instanceof ApiError) || !err.isUnauthenticated) return null;
  const path = stripPrefix(ctx.prefix, ctx.pathname);
  if (isPreviewPath(path) || /^\/(sign-in|sign-up|forgot-password|reset-password)(\/|$)/.test(path)) return null;
  if (isPrivatePath(path) || (ctx.mutation && ctx.signedIn)) return { redirect: expiredSignInHref(ctx.prefix, `${path}${ctx.search}`) };
  return ctx.signedIn ? { refresh: true } : null;
}

/** `/sign-in?next=<page>&reason=session_expired`, in the visitor's language. `next` is a locale-less app path. */
export function expiredSignInHref(prefix: string, next: string): string {
  const href = routes.signIn(next);
  return withPrefix(prefix, `${href}${href.includes('?') ? '&' : '?'}reason=${SESSION_EXPIRED}`);
}
