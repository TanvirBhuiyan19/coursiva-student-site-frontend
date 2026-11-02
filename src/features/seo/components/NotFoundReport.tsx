'use client';
import { useEffect } from 'react';

/** The site's own endpoint that reports a 404 (src/app/[tenant]/not-found-report, mapped by the proxy). */
export const NOT_FOUND_ENDPOINT = '/__404';

/**
 * Rendered by the 404 page: asks the site's server to report the miss, once. Only the path is sent; where the visit
 * came from is what the server saw of it (src/features/seo/notFound.ts), never the browser's word. Running from the
 * page also leaves out crawlers that don't execute scripts. Renders nothing.
 */
export function NotFoundReport() {
  useEffect(() => {
    if (/^\/preview(?:\/|$)/.test(window.location.pathname)) return;
    void fetch(NOT_FOUND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  }, []);
  return null;
}
