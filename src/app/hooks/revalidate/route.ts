import { createHmac, timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { env } from '@/config/env';
import { forgetRedirects } from '@/features/seo/redirects';

/**
 * Cache invalidation webhook, called by Laravel whenever tenant content changes (course published, price edited,
 * site builder saved, domain or theme changed). Host-agnostic: the proxy skips `/hooks/*`.
 *
 *   POST /hooks/revalidate
 *   X-Coursiva-Signature: sha256=<hex HMAC-SHA256 of the raw body with REVALIDATE_SECRET>
 *   { "tags": ["t:amplify:course:the-funnel-blueprint", "t:amplify:catalog"] }
 *
 * Tags are listed in lib/api/server.ts (`cacheTags`). Tagged data expires at once (`{ expire: 0 }`, no
 * stale-while-revalidate): the next request after a publish renders fresh content instead of one more stale page.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const given = req.headers.get('x-coursiva-signature')?.replace(/^sha256=/, '') ?? '';
  const expected = createHmac('sha256', env.REVALIDATE_SECRET).update(raw).digest('hex');
  const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ message: 'Invalid signature.' }, { status: 401 });

  let tags: unknown;
  try {
    tags = (JSON.parse(raw) as { tags?: unknown }).tags;
  } catch {
    return Response.json({ message: 'Body must be JSON.' }, { status: 400 });
  }
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > 100 ||
    !tags.every((t) => typeof t === 'string' && /^t:[a-z0-9-]+(:[\w.-]+)*$/.test(t))
  ) {
    return Response.json({ message: 'Provide 1–100 cache tags like "t:<tenant>:catalog".' }, { status: 422 });
  }
  for (const tag of tags as string[]) {
    revalidateTag(tag, { expire: 0 });
    // The proxy's in-memory redirect table (src/features/seo/redirects.ts) follows the tenant's site-wide tag.
    const whole = /^t:([a-z0-9-]+)$/.exec(tag);
    if (whole?.[1]) forgetRedirects(whole[1]);
  }
  return Response.json({ revalidated: tags });
}
