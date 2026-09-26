/** Liveness probe for load balancers and deploy checks (host-agnostic; the proxy skips /hooks/*). */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
