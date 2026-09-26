/**
 * Mock backend — a stand-in for the Laravel API with the same URLs, JSON shapes, cookies and status codes, so the
 * Next.js app talks to it exactly as it will talk to Laravel. Contract: docs/api/*.md and src/features/<f>/types.ts.
 */
import { Hono } from 'hono';
import { type Env, csrf, reset, resolveHost, withTenant } from './lib/db';
import { ok } from './lib/http';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { commerceRoutes } from './routes/commerce';
import { communityRoutes } from './routes/community';
import { learningRoutes } from './routes/learning';
import { publicRoutes } from './routes/public';

const SERVICE_TOKEN = process.env.API_SERVICE_TOKEN ?? 'dev-service-token';
const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN ?? 'localhost';
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);

export const app = new Hono<Env>();

if (LATENCY_MS > 0) app.use('*', async (_c, next) => new Promise((r) => setTimeout(() => r(next()), LATENCY_MS)));

/* Platform (server-to-server only). */
app.get('/platform/v1/domains/resolve', (c) => {
  if (c.req.header('authorization') !== `Bearer ${SERVICE_TOKEN}`) return c.json({ message: 'Unauthenticated.' }, 401);
  const t = resolveHost(c.req.query('host') ?? '', ROOT_DOMAIN);
  return t ? ok(c, t.resolution) : c.json({ message: 'Unknown host.' }, 404);
});

/* Test hook: restore the seed. Never exists in the real API. */
app.post('/__mock/reset', (c) => {
  reset();
  return c.body(null, 204);
});

app.use('/sanctum/*', withTenant);
app.use('/api/*', withTenant, csrf);
app.route('/', authRoutes);
app.route('/api/v1', publicRoutes);
app.route('/api/v1', learningRoutes);
app.route('/api/v1', commerceRoutes);
app.route('/api/v1', communityRoutes);
app.route('/api/v1', accountRoutes);

app.notFound((c) => c.json({ message: 'Not found.' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: 'Server error.' }, 500);
});
