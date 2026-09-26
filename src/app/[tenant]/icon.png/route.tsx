import { ImageResponse } from 'next/og';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { getSite } from '@/features/tenant/server';
import { brandHex } from '@/lib/theme';

/**
 * Per-tenant favicon at `/icon.png`: the brand tile with the school's initial — never a platform logo.
 * A route handler (not the `icon.tsx` convention), because the convention would emit `/{tenant}/icon` URLs.
 */
/**
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/icon.png'>) {
  const site = await getSite((await params).tenant);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 18,
        background: brandHex(site.brand).brand,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 38,
        fontWeight: 800,
      }}
    >
      {site.name.charAt(0).toUpperCase()}
    </div>,
    { width: 64, height: 64, headers: { 'Cache-Control': CDN_CACHE } },
  );
}
