import 'server-only';
import { cookies, draftMode } from 'next/headers';
import { cache } from 'react';

/**
 * Personal rendering. Public pages are rendered once and cached for everyone, so they never read cookies. A few
 * visitors need pages built for them instead: a dashboard preview (the draft, `?preview=<token>`) and a visitor who
 * unlocked a password-locked site. For those, `/__site` switches on Next's Draft Mode (a bypass cookie): their
 * requests skip every cache, and server reads forward their cookies (and the preview token) to the API, which
 * answers `Cache-Control: private, no-store`. The API stays the gate — the bypass cookie only turns caching off.
 *
 * `draftMode()` doesn't make a static render dynamic (it reports "off" there), so calling this from any server read
 * is safe; `cookies()` is only read when Draft Mode is on (a dynamic request already).
 */

/** httpOnly cookie holding the dashboard preview token while a preview is open. */
export const PREVIEW_COOKIE = 'coursiva_preview';
/** Next's Draft Mode cookie. Never forwarded to the API. */
const BYPASS_COOKIE = '__prerender_bypass';

export interface Personal {
  /** The visitor's cookies for the API (session and unlock cookies), without the preview/bypass cookies. */
  cookie: string;
  /** The dashboard preview token, when a preview is open. */
  preview: string | null;
}

export const personalContext = cache(async (): Promise<Personal | null> => {
  let enabled = false;
  try {
    enabled = (await draftMode()).isEnabled;
  } catch {
    // Outside a request (build-time work): never personal.
    return null;
  }
  if (!enabled) return null;
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .filter((c) => c.name !== BYPASS_COOKIE && c.name !== PREVIEW_COOKIE)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const preview = jar.get(PREVIEW_COOKIE)?.value ?? null;
  return { cookie, preview: preview && /^[A-Za-z0-9_-]{1,200}$/.test(preview) ? preview : null };
});
