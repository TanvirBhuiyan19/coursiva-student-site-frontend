/**
 * Mock backend — a stand-in for the Laravel API with the same URLs, JSON shapes, cookies and status codes, so the
 * Next.js app talks to it exactly as it will talk to Laravel. Contract: docs/api/*.md and src/features/<f>/types.ts.
 */
import { Hono } from 'hono';
import { type Env, allTenants, csrf, reset, resolveHost, withTenant } from './lib/db';
import { nextId, participant, roomOf } from './lib/liveRoom';
import { body, invalid, noContent, ok, str } from './lib/http';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { bookingRoutes } from './routes/bookings';
import { commerceRoutes } from './routes/commerce';
import { communityRoutes } from './routes/community';
import { learningRoutes } from './routes/learning';
import { liveRoutes } from './routes/live';
import { webinarRoutes } from './routes/webinars';
import { formHooks, formRoutes } from './routes/forms';
import { previewRoutes } from './routes/preview';
import { publicRoutes } from './routes/public';
import { seoHook, seoRoutes } from './routes/seo';
import { siteRoutes } from './routes/site';
import { assessmentRoutes } from './routes/assessment';
import { scormRoutes, xapiRoutes } from './routes/scorm';
import { normalizeTracking } from '@/features/tracking/ids';
import { tutorRoutes } from './routes/tutor';

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

/*
 * Test hook: a school's tracking tags (`GET /site` → `tracking`, camelCase as the site reads it; `null` = none).
 * The API sets them from the dashboard (SEO trackers, Settings → Integrations). Never exists in the real API.
 */
app.post('/__mock/tracking/:tenant', async (c) => {
  const t = allTenants().find((x) => x.resolution.tenant === c.req.param('tenant'));
  if (!t) return c.json({ message: 'Unknown tenant.' }, 404);
  t.site.tracking = normalizeTracking(await c.req.json().catch(() => null));
  return c.body(null, 204);
});

/*
 * Test hook: platform feature availability (the console's switches + missing connections): `{ unavailable: ['ai', …] }`.
 * `GET /site` then reports it and applies it to sign-in providers, SSO and features. Never exists in the real API.
 */
app.post('/__mock/availability/:tenant', async (c) => {
  const t = allTenants().find((x) => x.resolution.tenant === c.req.param('tenant'));
  if (!t) return c.json({ message: 'Unknown tenant.' }, 404);
  const body = (await c.req.json().catch(() => null)) as { unavailable?: unknown } | null;
  t.unavailable = Array.isArray(body?.unavailable) ? body.unavailable.filter((k): k is string => typeof k === 'string') : [];
  return c.body(null, 204);
});

/* Test hook: restore the seed. Never exists in the real API. */
app.post('/__mock/reset', (c) => {
  reset();
  return c.body(null, 204);
});

/*
 * Test hook: the host's side of a live room (the tenant dashboard's booth writes the same state through Laravel/Go).
 * `POST /__mock/live/{tenant}/{session}` with `{ action, … }`. Never exists in the real API.
 */
app.post('/__mock/live/:tenant/:session', async (c) => {
  const t = allTenants().find((x) => x.resolution.tenant === c.req.param('tenant'));
  if (!t) return c.json({ message: 'Unknown tenant.' }, 404);
  const room = roomOf(t, c.req.param('session'));
  const b = await body<{
    action: string;
    text?: string;
    email?: string;
    question?: string;
    options?: string[];
    seconds?: number;
    on?: boolean;
  }>(c);
  const user = b.email ? t.users.find((u) => u.email === b.email) : undefined;
  const latest = (text?: string) => [...room.chat].reverse().find((m) => !text || m.message === text);
  switch (b.action) {
    case 'hide': {
      const m = latest(b.text);
      if (!m) return c.json({ message: 'Message not found.' }, 404);
      m.hiddenAt = new Date().toISOString();
      if (room.pinnedId === m.id) room.pinnedId = null;
      break;
    }
    case 'pin':
      room.pinnedId = latest(b.text)?.id ?? null;
      break;
    case 'announce': {
      const id = nextId('lc');
      room.chat.push({
        id,
        userId: 'usr_host',
        who: 'Maya Chen',
        message: b.text ?? '',
        kind: 'announcement',
        hiddenAt: null,
        createdAt: new Date().toISOString(),
      });
      room.pinnedId = id;
      break;
    }
    case 'slow':
      room.slowSec = b.seconds ?? 0;
      break;
    case 'lock':
      room.locked = b.on ?? true;
      break;
    case 'poll':
      room.polls.forEach((p) => (p.status = 'closed'));
      room.polls.push({
        id: nextId('lp'),
        question: b.question ?? '',
        options: b.options ?? [],
        votes: new Map(),
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      break;
    case 'closePoll':
      room.polls.forEach((p) => (p.status = 'closed'));
      break;
    case 'stage':
    case 'unstage':
    case 'mute':
    case 'remove': {
      if (!user) return c.json({ message: 'Participant not found.' }, 404);
      const p = participant(room, user.id);
      if (b.action === 'stage') p.stage = 'invited';
      else if (b.action === 'unstage') p.stage = null;
      else if (b.action === 'mute') Object.assign(p, { muted: b.on ?? true, stage: null });
      else Object.assign(p, { removed: b.on ?? true, stage: null, handRaised: false, breakoutId: null });
      break;
    }
    case 'breakout': {
      if (!user) return c.json({ message: 'Participant not found.' }, 404);
      const r = { id: nextId('lbr'), name: 'Room 1' };
      room.breakouts = { rooms: [r], openedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 10 * 60_000).toISOString() };
      participant(room, user.id).breakoutId = r.id;
      break;
    }
    case 'broadcast':
      room.chat.push({
        id: nextId('lc'),
        userId: 'usr_host',
        who: 'Maya Chen',
        message: b.text ?? '',
        kind: 'broadcast',
        hiddenAt: null,
        createdAt: new Date().toISOString(),
      });
      break;
    case 'closeBreakouts':
      room.breakouts = { rooms: [], openedAt: null, endsAt: null };
      room.participants.forEach((p) => (p.breakoutId = null));
      break;
    default:
      return c.json({ message: 'Unknown action.' }, 422);
  }
  return c.body(null, 204);
});

/*
 * xAPI LRS: a stateless surface (Basic auth from the launch, no session, no CSRF) — registered before the CSRF
 * middleware, like Laravel's separate `xapi` surface.
 */
app.route('/api/v1/xapi', xapiRoutes);
/* Staff preview (O7): the token is the only credential — no session, no cookies, so no CSRF either. */
app.route('/api/v1/preview', previewRoutes);
/* Public lead forms: anonymous and CSRF-exempt (the signed form token is the proof), CORS `*` without credentials. */
app.route('/api/v1/forms', formRoutes);
/* Test hook: a lead form's counters, submissions and uploads. Never exists in the real API. */
app.route('/__mock/forms', formHooks);

app.use('/sanctum/*', withTenant);
app.use('/api/*', withTenant, csrf);
/*
 * Server-side page views (server-to-server only): the learner site's proxy reports each page it serves. Laravel hashes
 * visitor_ip + user_agent with a daily salt and stores neither, and classifies the visit by the optional external
 * `referrer`; the mock validates and discards. Always 204 once valid.
 */
app.post('/api/v1/analytics/pageviews', async (c) => {
  if (c.req.header('authorization') !== `Bearer ${SERVICE_TOKEN}`) return c.json({ message: 'Unauthenticated.' }, 401);
  const b = await body<{ path: string; visitorIp: string; userAgent: string; referrer?: string | null }>(c);
  const path = str(b.path);
  if (!path.startsWith('/') || path.length > 2000) return invalid(c, { path: 'The path field must start with /.' });
  if (!/^[\d.]+$|:/.test(str(b.visitorIp))) return invalid(c, { visitorIp: 'The visitor ip field must be a valid IP address.' });
  if (b.userAgent !== undefined && b.userAgent !== null && (typeof b.userAgent !== 'string' || b.userAgent.length > 500))
    return invalid(c, { userAgent: 'The user agent field must not be greater than 500 characters.' });
  if (b.referrer !== undefined && b.referrer !== null && (typeof b.referrer !== 'string' || b.referrer.length > 2000))
    return invalid(c, { referrer: 'The referrer field must not be greater than 2000 characters.' });
  return noContent(c);
});

app.route('/', authRoutes);
app.get('/__mock/seo', withTenant, seoHook);
app.route('/api/v1', seoRoutes);
app.route('/api/v1', siteRoutes);
app.route('/api/v1', publicRoutes);
app.route('/api/v1', liveRoutes);
app.route('/api/v1', webinarRoutes);
app.route('/api/v1', learningRoutes);
app.route('/api/v1', commerceRoutes);
app.route('/api/v1', bookingRoutes);
app.route('/api/v1', communityRoutes);
app.route('/api/v1', accountRoutes);
app.route('/api/v1', assessmentRoutes);
app.route('/api/v1', scormRoutes);
app.route('/api/v1', tutorRoutes);

app.notFound((c) => c.json({ message: 'Not found.' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: 'Server error.' }, 500);
});
