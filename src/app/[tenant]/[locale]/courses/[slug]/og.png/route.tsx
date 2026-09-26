import { ImageResponse } from 'next/og';
import { CDN_CACHE } from '@/lib/cacheHeaders';
import { createTranslator } from 'next-intl';
import { loadMessages } from '@/i18n/messages';
import { getCourse } from '@/features/catalog/server';
import { getSite } from '@/features/tenant/server';
import { formatMoney } from '@/lib/format';
import { brandHex } from '@/lib/theme';

/** Social share card (1200×630) for a course, in the tenant's brand. Used when the course has no uploaded cover. */
/**
 * Rendered per request (the tenant comes from the URL, so nothing can be prebuilt) from Data-Cache-backed reads, and
 * cached at the CDN via Cache-Control. The CDN must key on Host — every tenant has its own copy.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/[tenant]/[locale]/courses/[slug]/og.png'>) {
  const { tenant, locale, slug } = await params;
  const [site, course, messages] = await Promise.all([getSite(tenant, locale), getCourse(tenant, slug, locale), loadMessages(locale)]);
  if (!course) return new Response('Not found', { status: 404 });
  const c = brandHex(site.brand);
  const t = createTranslator({ locale, messages, namespace: 'common' });
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: c.deep,
        color: 'white',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, fontWeight: 700 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: c.brand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          {site.name.charAt(0).toUpperCase()}
        </div>
        {site.name}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: c.tint, opacity: 0.8 }}>
          {course.category.name}
        </div>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{course.title}</div>
      </div>
      <div style={{ display: 'flex', gap: 28, fontSize: 28, color: c.tint }}>
        <span>★ {course.rating.toFixed(1)}</span>
        <span>{t('lessons', { count: course.lessonCount })}</span>
        <span>{formatMoney(course.price, locale)}</span>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'Cache-Control': CDN_CACHE } },
  );
}
