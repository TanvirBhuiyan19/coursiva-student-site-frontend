import { EMBED_SCRIPT } from '@/features/forms/embedScript';
import { CDN_CACHE } from '@/lib/cacheHeaders';

/**
 * `/embed/forms.js` on every school host (the proxy rewrites it here, like sitemap.xml): the lead-form embed script
 * (src/features/forms/embedScript.ts). The same file for every school — it finds its school from its own `src` — and
 * cached for an hour. Loaded by other websites, so it may be fetched cross-origin (CORP `cross-origin`).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(EMBED_SCRIPT, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': CDN_CACHE,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
