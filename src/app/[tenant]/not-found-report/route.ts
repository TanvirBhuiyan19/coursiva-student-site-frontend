import { env } from '@/config/env';
import { clientIp } from '@/features/analytics/pageviews';
import { isSameOrigin, reportablePath, reportNotFound, takeVisit, visitorOf } from '@/features/seo/notFound';

/**
 * `POST /__404 {path}` (the proxy maps it here): the 404 page asks this server to report its path to the school's 404
 * monitor. The browser gives only the path; whether the visit came from the site's own pages, and the external
 * referrer, are what the proxy saw of that visit (src/features/seo/notFound.ts explains why). Same-origin requests
 * only; always 204.
 */
export const dynamic = 'force-dynamic';

const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(req: Request, { params }: RouteContext<'/[tenant]/not-found-report'>) {
  const { tenant } = await params;
  const host = (req.headers.get('host') ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!isSameOrigin(req.headers, host)) return done();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return done();
  }
  const path = reportablePath((body as { path?: unknown } | null)?.path);
  const visitorIp = clientIp(req.headers);
  if (!path || !visitorIp) return done();
  const userAgent = req.headers.get('user-agent') ?? '';
  await reportNotFound({
    apiUrl: env.API_URL,
    serviceToken: env.API_SERVICE_TOKEN,
    tenant,
    path,
    visitorIp,
    userAgent,
    visit: takeVisit(tenant, visitorOf(visitorIp, userAgent), path),
  });
  return done();
}
