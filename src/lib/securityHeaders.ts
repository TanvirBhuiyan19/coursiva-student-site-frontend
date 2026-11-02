/**
 * Security headers (next.config.ts for every response, the proxy for staff previews). Pure — no env access — so the
 * Next config, the proxy and tests share one definition.
 *
 * A nonce-based CSP would force every page to render dynamically (no ISR), so the policy locks down framing, plugins,
 * base URIs and form targets without a script-src; add one with hashes if/when a third-party script policy is agreed.
 *
 * Framing: pages may not be framed at all (`frame-ancestors 'none'` + `X-Frame-Options: DENY`) — except the staff
 * preview (`/preview/*`, course builder v2 O7), which only the dashboard's origin may frame. The proxy sets that policy
 * from `DASHBOARD_ORIGIN` (src/config/env.ts). `/api/*` and `/sanctum/*` (streamed from the API) keep
 * `frame-ancestors 'self'`: SCORM packages are served there and play in the player's same-origin iframe. The lead-form
 * embed frame (`/embed/forms/{id}`, unprefixed, nothing below it) is the one page any website may frame — it is what
 * `/embed/forms.js` puts on schools' other sites (src/features/forms/embedScript.ts).
 */

type Header = { key: string; value: string };

const CSP_REST = "base-uri 'self'; object-src 'none'; form-action 'self'";

/** Every response. */
export const baseHeaders: Header[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Stripe's Payment Element runs Apple Pay / Google Pay inside its js.stripe.com iframe. The built-in live room's
  // video is Daily Prebuilt in an https://*.daily.co frame: camera, microphone and screen sharing are delegated to it
  // only (the site itself never asks for them).
  {
    key: 'Permissions-Policy',
    value:
      'camera=("https://*.daily.co"), microphone=("https://*.daily.co"), display-capture=("https://*.daily.co"), geolocation=(), payment=(self "https://js.stripe.com")',
  },
];

/** Pages (everything but the API, Sanctum and the staff preview): never framed. */
export const pageHeaders: Header[] = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // No frame-src / connect-src here (none is restricted today), so Daily's frame and call servers need no entry.
  { key: 'Content-Security-Policy', value: `frame-ancestors 'none'; ${CSP_REST}` },
];

/** API and Sanctum responses streamed through the proxy (SCORM content frames same-origin). */
export const apiHeaders: Header[] = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: `frame-ancestors 'self'; ${CSP_REST}` },
];

/**
 * The lead-form embed frame: framable by any site (`frame-ancestors *`, no X-Frame-Options), never indexed. It holds
 * no session (its API calls are anonymous) and talks to its parent only through postMessage to the `origin` it was
 * given (src/features/forms/components/EmbedFrame.tsx).
 */
export const embedHeaders: Header[] = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: `frame-ancestors *; ${CSP_REST}` },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** Path patterns (Next `headers()` sources). Pages = anything not under api/, sanctum/ or preview, nor an embed frame. */
export const PAGE_SOURCE = '/:path((?!api/|sanctum/|preview(?:/|$)|embed/forms/[^/]+/?$).*)';
export const EMBED_SOURCE = '/embed/forms/:id';
export const PREVIEW_PREFIX = '/preview';

/** `/preview` and `/preview/…` — the staff preview's pages. */
export const isPreviewPath = (path: string) => path === PREVIEW_PREFIX || path.startsWith(`${PREVIEW_PREFIX}/`);

/**
 * The staff preview's headers: framed only by the dashboard (`origins`; none → not framable at all), no referrer
 * leaves the page (the token is in the URL), never indexed. (Never cached either: the pages are dynamic, so Next sends
 * `Cache-Control: private, no-store` itself.)
 */
export function previewHeaders(origins: readonly string[]): Header[] {
  const ancestors = origins.length ? origins.join(' ') : "'none'";
  return [
    { key: 'Content-Security-Policy', value: `frame-ancestors ${ancestors}; ${CSP_REST}` },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ];
}

/** Static preview headers for next.config (the CSP, which needs the env, comes from the proxy). */
export const previewStaticHeaders: Header[] = previewHeaders([]).filter((h) => h.key !== 'Content-Security-Policy');

/**
 * `DASHBOARD_ORIGIN`: one or more origins (comma or space separated), each `http(s)://host[:port]` with nothing after.
 * Returns the normalised origins, or null when a value isn't a bare origin (so a typo can't widen or break the header).
 */
export function parseOrigins(value: string): string[] | null {
  const out: string[] = [];
  for (const item of value.split(/[\s,]+/).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== item.replace(/\/$/, '')) return null;
    out.push(url.origin);
  }
  return out;
}
