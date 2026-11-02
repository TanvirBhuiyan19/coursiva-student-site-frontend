import { cookies, draftMode } from 'next/headers';
import { PREVIEW_COOKIE } from '@/lib/api/personal';

/**
 * Personal rendering on/off (lib/api/personal.ts). Public URL `/__site` (the proxy maps it here, and sends any page
 * request carrying `?preview=` here too):
 *
 *   GET  /__site?preview=<token>&next=/about   dashboard preview link → Draft Mode on + token cookie → 307 to `next`
 *   POST /__site  action=personal              after unlocking a locked site → Draft Mode on → 204
 *   POST /__site  action=exit [next=/path]     leave the preview → both cookies cleared → 303 to `next`
 *
 * Turning Draft Mode on grants nothing by itself: it only stops caching for this browser, so the API — which checks
 * the preview token and unlock cookies — decides what the visitor sees.
 */
export const dynamic = 'force-dynamic';

const PREVIEW_DAYS = 7;

/** A same-site path to go back to (never `//host` or an absolute URL: no open redirect). */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/');

const redirect = (location: string, status: 303 | 307) =>
  new Response(null, { status, headers: { Location: location, 'Cache-Control': 'private, no-store' } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('preview') ?? '';
  const next = safeNext(url.searchParams.get('next'));
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(token)) return redirect(next, 307);
  (await draftMode()).enable();
  (await cookies()).set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: PREVIEW_DAYS * 86400,
  });
  return redirect(next, 307);
}

export async function POST(req: Request) {
  // Same-origin only: a cross-site form can't toggle this.
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return new Response(null, { status: 403 });
  const form = await req.formData().catch(() => null);
  const action = form?.get('action');
  if (action === 'personal') {
    (await draftMode()).enable();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'exit') {
    (await draftMode()).disable();
    (await cookies()).delete(PREVIEW_COOKIE);
    const next = form?.get('next');
    return redirect(safeNext(typeof next === 'string' ? next : null), 303);
  }
  return new Response(null, { status: 422 });
}
